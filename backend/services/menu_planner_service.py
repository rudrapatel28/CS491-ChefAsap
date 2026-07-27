"""
Orchestrator for the Menu & Event Planner LLM feature.

Steps for a /plan request:
  1. SQL: fetch top-20 nearby chefs (cuisine+distance+rating filtered)
  2. SQL: fetch pricing rows for those chefs + live multiplier from DynamicPricingEngine
  3. LLM (menu_generation): produce the full four-capability plan
  4. Post-process: feed the LLM's recommended chef_ids through rank_chefs()
     to attach ML match_score
  5. Persist the plan to event_plans table
  6. Return the enriched plan + usage stats
"""

import json
import uuid
from datetime import datetime

from database.db_helper import get_db_connection, get_cursor
from ml.matching_scorer import rank_chefs
from services.pricing_engine import DynamicPricingEngine
from services.llm_service import call_llm, DEFAULT_MODEL, FAST_MODEL
from services.prompts import menu_generation, ingredients, cost_estimation, chef_recommendation

_pricing_engine = DynamicPricingEngine()


# ---------------------------------------------------------------------------
# Chef retrieval
# ---------------------------------------------------------------------------

def _fetch_candidate_chefs(
    conn, latitude: float, longitude: float, cuisine: str, limit: int = 20
) -> list[dict]:
    """
    Return up to `limit` chefs filtered by cuisine (if provided) and
    minimum average_rating >= 4.0, ordered by distance.
    Mirrors the query shape from search_bp.py lines 54-97.
    """
    cursor = get_cursor(conn, dictionary=True)
    try:
        params = [latitude, longitude, latitude, latitude, longitude, latitude]
        cuisine_filter = ""
        if cuisine:
            # Cannot reference a SELECT alias in HAVING; use the full aggregate expression.
            cuisine_filter = "AND STRING_AGG(ct.name, ', ' ORDER BY ct.name) ILIKE %s"
            params.append(f"%{cuisine}%")

        query = f"""
            SELECT
                c.id AS chef_id,
                c.first_name || ' ' || c.last_name AS full_name,
                STRING_AGG(ct.name, ', ' ORDER BY ct.name) AS cuisines,
                crs.average_rating,
                crs.total_reviews,
                cp.base_rate_per_person,
                cp.minimum_people,
                cp.maximum_people,
                ca.city,
                ca.state,
                ca.zip_code,
                ca.latitude,
                ca.longitude,
                (3959 * acos(cos(radians(%s)) * cos(radians(ca.latitude)) *
                    cos(radians(ca.longitude) - radians(%s)) +
                    sin(radians(%s)) * sin(radians(ca.latitude)))) AS distance_miles
            FROM chefs c
            INNER JOIN chef_addresses ca ON c.id = ca.chef_id AND ca.is_default = TRUE
            LEFT JOIN chef_pricing cp ON c.id = cp.chef_id
            LEFT JOIN chef_cuisines cc ON c.id = cc.chef_id
            LEFT JOIN cuisine_types ct ON cc.cuisine_id = ct.id
            LEFT JOIN chef_rating_summary crs ON c.id = crs.chef_id
            WHERE ca.latitude IS NOT NULL AND ca.longitude IS NOT NULL
            GROUP BY c.id, c.first_name, c.last_name,
                     crs.average_rating, crs.total_reviews,
                     cp.base_rate_per_person, cp.minimum_people, cp.maximum_people,
                     ca.city, ca.state, ca.zip_code, ca.latitude, ca.longitude
            HAVING
                COALESCE(crs.average_rating, 0) >= 4.0
                AND (3959 * acos(cos(radians(%s)) * cos(radians(ca.latitude)) *
                    cos(radians(ca.longitude) - radians(%s)) +
                    sin(radians(%s)) * sin(radians(ca.latitude)))) <= 50
                {cuisine_filter}
            ORDER BY distance_miles ASC, crs.average_rating DESC
            LIMIT %s
        """
        params.append(limit)
        cursor.execute(query, params)
        rows = cursor.fetchall()
        chefs = []
        for row in rows:
            chefs.append({
                "chef_id": row["chef_id"],
                "full_name": row["full_name"],
                "cuisines": row["cuisines"] or "",
                "average_rating": float(row["average_rating"]) if row["average_rating"] else None,
                "total_reviews": row["total_reviews"] or 0,
                "base_rate_per_person": float(row["base_rate_per_person"]) if row["base_rate_per_person"] else None,
                "minimum_people": row["minimum_people"],
                "maximum_people": row["maximum_people"],
                "city": row["city"],
                "state": row["state"],
                "distance_miles": round(float(row["distance_miles"]), 1) if row["distance_miles"] else None,
            })
        return chefs
    finally:
        cursor.close()


def _build_pricing_context(
    chefs: list[dict], event_date: str, zip_code: str, guest_count: int
) -> list[dict]:
    """
    Enrich each chef's base rate with the dynamic multiplier from DynamicPricingEngine.
    Falls back gracefully if pricing data is unavailable.
    """
    pricing_rows = []
    for chef in chefs:
        base_rate = chef.get("base_rate_per_person")
        if base_rate is None:
            pricing_rows.append({
                "chef_id": chef["chef_id"],
                "base_rate_per_person": None,
                "dynamic_rate_per_person": None,
                "multiplier": None,
            })
            continue
        try:
            quote = _pricing_engine.calculate_quote(
                base_price=base_rate * guest_count,
                event_date_str=event_date + "T18:00:00",
                location_zip=zip_code,
                chef_id=chef["chef_id"],
                customer_id=0,
            )
            multiplier = quote.get("multiplier", 1.0)
        except Exception:
            multiplier = 1.0

        pricing_rows.append({
            "chef_id": chef["chef_id"],
            "base_rate_per_person": base_rate,
            "dynamic_rate_per_person": round(base_rate * multiplier, 2),
            "multiplier": round(multiplier, 3),
        })
    return pricing_rows


# ---------------------------------------------------------------------------
# ML re-ranking
# ---------------------------------------------------------------------------

def _rerank_with_ml(plan: dict, latitude: float, longitude: float) -> dict:
    """
    Feed the LLM's recommended_chefs chef_ids through rank_chefs() to attach
    the trained match_score. Returns the enriched plan.
    """
    recs = plan.get("recommended_chefs", [])
    if not recs:
        return plan

    chef_ids = [r["chef_id"] for r in recs if isinstance(r.get("chef_id"), int)]
    if not chef_ids:
        return plan

    try:
        ranked = rank_chefs({
            "latitude": latitude,
            "longitude": longitude,
            "chef_ids": chef_ids,
        })
        score_map = {r["chef_id"]: r.get("match_score") for r in ranked}
    except Exception:
        score_map = {}

    for rec in recs:
        cid = rec.get("chef_id")
        if cid in score_map:
            rec["ml_score"] = score_map[cid]

    plan["recommended_chefs"] = sorted(
        recs, key=lambda r: r.get("ml_score") or 0, reverse=True
    )
    return plan


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _persist_plan(
    conn,
    customer_id: int,
    conversation_id: str,
    event_date: str,
    cuisine: str,
    guest_count: int,
    plan: dict,
    usage: dict,
) -> int:
    """Insert the plan into event_plans and return the new row id."""
    cursor = get_cursor(conn)
    try:
        cursor.execute(
            """
            INSERT INTO event_plans
                (customer_id, conversation_id, event_date, cuisine_type, guest_count,
                 plan_json, llm_model, llm_input_tokens, llm_output_tokens, llm_cache_read_tokens)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                customer_id,
                conversation_id,
                event_date or None,
                cuisine or None,
                guest_count,
                json.dumps(plan),
                usage.get("model"),
                usage.get("input_tokens", 0),
                usage.get("output_tokens", 0),
                usage.get("cache_read_input_tokens", 0),
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        return row['id']
    finally:
        cursor.close()


def _persist_message(conn, conversation_id: str, role: str, content: str):
    cursor = get_cursor(conn)
    try:
        cursor.execute(
            """
            INSERT INTO event_plan_messages (conversation_id, role, content)
            VALUES (%s, %s, %s)
            """,
            (conversation_id, role, content),
        )
        conn.commit()
    finally:
        cursor.close()


def _load_messages(conn, conversation_id: str) -> list[dict]:
    cursor = get_cursor(conn, dictionary=True)
    try:
        cursor.execute(
            """
            SELECT role, content FROM event_plan_messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC
            """,
            (conversation_id,),
        )
        return [{"role": r["role"], "content": r["content"]} for r in cursor.fetchall()]
    finally:
        cursor.close()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_event_plan(
    customer_id: int,
    latitude: float,
    longitude: float,
    zip_code: str,
    cuisine: str,
    guest_count: int,
    event_date: str,
    dietary: list[str],
) -> dict:
    """
    One-shot plan creation. Returns the enriched plan dict plus metadata.
    """
    conversation_id = str(uuid.uuid4())
    conn = get_db_connection()
    try:
        chefs = _fetch_candidate_chefs(conn, latitude, longitude, cuisine)
        pricing_ctx = _build_pricing_context(chefs, event_date, zip_code, guest_count)

        context = {
            "cuisine": cuisine,
            "guest_count": guest_count,
            "event_date": event_date,
            "dietary": dietary,
            "zip_code": zip_code,
            "available_chefs": chefs,
            "pricing_context": pricing_ctx,
        }

        messages = menu_generation.build_messages(context)
        plan, usage = call_llm(messages)
        plan = _rerank_with_ml(plan, latitude, longitude)

        plan_id = _persist_plan(
            conn, customer_id, conversation_id, event_date,
            cuisine, guest_count, plan, usage,
        )
        _persist_message(conn, conversation_id, "user", json.dumps(context))
        _persist_message(conn, conversation_id, "assistant", json.dumps(plan))

        return {
            "plan_id": plan_id,
            "conversation_id": conversation_id,
            "plan": plan,
            "usage": usage,
        }
    finally:
        conn.close()


def continue_conversation(
    customer_id: int,
    conversation_id: str,
    user_message: str,
    latitude: float = 0.0,
    longitude: float = 0.0,
) -> dict:
    """
    Multi-turn follow-up. Loads conversation history, appends the new user
    message, calls Claude with the fast model, persists, returns the response.
    """
    conn = get_db_connection()
    try:
        history = _load_messages(conn, conversation_id)
        history.append({"role": "user", "content": user_message})

        plan, usage = call_llm(history, model=FAST_MODEL)

        if isinstance(plan, dict) and not plan.get("_parse_error"):
            plan = _rerank_with_ml(plan, latitude, longitude)

        _persist_message(conn, conversation_id, "user", user_message)
        _persist_message(conn, conversation_id, "assistant", json.dumps(plan))

        return {
            "conversation_id": conversation_id,
            "response": plan,
            "usage": usage,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Conversational chat (bootstraps a new conversation on first turn)
# ---------------------------------------------------------------------------

def _lookup_customer_location(conn, customer_id: int) -> tuple[float | None, float | None]:
    """Return (lat, lon) from the customer's default saved address, or (None, None)."""
    cursor = get_cursor(conn, dictionary=True)
    try:
        cursor.execute(
            """
            SELECT latitude, longitude FROM customer_addresses
            WHERE customer_id = %s AND is_default = TRUE
            LIMIT 1
            """,
            (customer_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None, None
        lat = row["latitude"]
        lon = row["longitude"]
        return (
            float(lat) if lat is not None else None,
            float(lon) if lon is not None else None,
        )
    finally:
        cursor.close()


def _to_ui_response(plan: dict, candidate_chefs: list[dict]) -> tuple[dict | None, str | None]:
    """
    Map the LLM's plan schema (system_prompt.py SECTION 2) onto the shape
    PlanCard.js / ChefSuggestionCard.js expect, and produce a short intro line.
    Returns (ui_plan_or_None, content_text_or_None).
    """
    if not isinstance(plan, dict) or plan.get("_parse_error"):
        # Surface the raw text so the user sees something rather than an empty bubble.
        raw = plan.get("raw_response") if isinstance(plan, dict) else None
        return None, raw or "I had trouble formatting that plan. Could you try rephrasing?"

    status = plan.get("status")
    event_summary = plan.get("event_summary") or {}
    cuisine = (event_summary.get("cuisine") or "").strip()

    if status == "not_culinary":
        return None, (
            "I can only help with culinary event planning. Tell me about your event — "
            "cuisine, guest count, and any dietary needs — and I'll suggest a menu."
        )

    if status == "needs_more_info":
        question = (plan.get("clarifying_question") or "").strip()
        return None, question or (
            "Could you tell me a bit more — cuisine or style, guest count, and any "
            "dietary needs? That'll help me put together a full menu."
        )

    # Group flat menu items by course → [{ course, dishes: [...] }]
    menu_by_course: dict[str, list[dict]] = {}
    course_order: list[str] = []
    for item in (plan.get("menu") or []):
        course = (item.get("course") or "main").strip().lower()
        if course not in menu_by_course:
            menu_by_course[course] = []
            course_order.append(course)
        menu_by_course[course].append({
            "name": item.get("dish") or item.get("name") or "",
            "description": item.get("rationale") or "",
        })
    menu = [{"course": c.capitalize(), "dishes": menu_by_course[c]} for c in course_order]

    # Ingredients: { item, quantity, unit } → { name, quantity }
    ingredients = []
    for ing in (plan.get("ingredients") or []):
        qty = ing.get("quantity")
        unit = ing.get("unit")
        if qty and unit:
            qty_str = f"{qty} {unit}"
        else:
            qty_str = qty or unit or ""
        ingredients.append({
            "name": ing.get("item") or ing.get("name") or "",
            "quantity": qty_str,
        })

    ce = plan.get("cost_estimate") or {}
    estimated_cost = {
        "total": ce.get("total_usd") if ce.get("total_usd") is not None else ce.get("total"),
        "per_person": ce.get("per_person_usd") if ce.get("per_person_usd") is not None else ce.get("per_person"),
        "breakdown": ce.get("breakdown"),
    }

    # Belt-and-suspenders: regardless of what status the model claimed, never
    # let a vacuous plan (no dishes, no ingredients, no cost) reach the UI as
    # if it were a real one. Catches prompt drift/regressions without relying
    # on the model getting `status` right every time.
    has_cost = bool(estimated_cost["total"]) or bool(estimated_cost["per_person"])
    if not menu and not ingredients and not has_cost:
        return None, (
            "I don't have enough detail yet to put together a plan — could you tell "
            "me the cuisine or style, guest count, and any dietary needs?"
        )

    # Enrich the LLM's chef IDs with profile data so ChefSuggestionCard can render.
    chef_lookup = {c["chef_id"]: c for c in candidate_chefs}
    chefs_ui = []
    for rec in (plan.get("recommended_chefs") or []):
        cid = rec.get("chef_id")
        base = chef_lookup.get(cid, {})
        full_name = base.get("full_name") or ""
        first, _, last = full_name.partition(" ")
        cuisines_str = base.get("cuisines") or ""
        chefs_ui.append({
            "chef_id": cid,
            "first_name": first or None,
            "last_name": last or None,
            "full_name": full_name or None,
            "rating": base.get("average_rating"),
            "cuisines": [c.strip() for c in cuisines_str.split(",") if c.strip()],
            "distance_miles": base.get("distance_miles"),
            "match_reason": rec.get("match_reason"),
        })

    ui_plan = {
        "menu": menu,
        "ingredients": ingredients,
        "estimated_cost": estimated_cost,
        "chefs": chefs_ui,
        "notes": plan.get("notes") or None,
    }

    # Short intro line shown above the PlanCard.
    guests = event_summary.get("guest_count")
    dietary = event_summary.get("dietary_notes") or []
    intro_parts = ["Here's your event plan"]
    desc_bits = []
    if cuisine:
        desc_bits.append(cuisine)
    if guests:
        desc_bits.append(f"for {guests} guests")
    if desc_bits:
        intro_parts.append("— " + " ".join(desc_bits))
    if dietary:
        intro_parts.append(f"({', '.join(dietary)})")
    content = " ".join(intro_parts) + ":"

    return ui_plan, content


def chat_turn(
    customer_id: int,
    conversation_id: str | None,
    user_message: str,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    """
    Conversational planner entry point. Bootstraps a new conversation when
    conversation_id is None. Returns a frontend-shaped response:
        { conversation_id, role, content, plan }
    """
    is_new = not conversation_id
    if is_new:
        conversation_id = str(uuid.uuid4())

    conn = get_db_connection()
    try:
        # Fall back to the customer's saved default address when the client
        # didn't include coordinates with the message.
        if latitude is None or longitude is None:
            db_lat, db_lon = _lookup_customer_location(conn, customer_id)
            latitude = latitude if latitude is not None else db_lat
            longitude = longitude if longitude is not None else db_lon

        # Fetch nearby chefs without a cuisine filter — the LLM picks fits from
        # the candidate set based on the user's free-text request. Cap at 8 to
        # keep the LLM input small enough to fit under the gunicorn 30s timeout.
        if latitude is not None and longitude is not None:
            chefs = _fetch_candidate_chefs(conn, latitude, longitude, cuisine="", limit=8)
        else:
            chefs = []
        pricing_ctx = _build_pricing_context(chefs, "", "", 1)

        history = [] if is_new else _load_messages(conn, conversation_id)

        # Trim the chef payload sent to the LLM: it only needs enough to pick
        # 3–5 fits. Keeping the full record server-side for UI enrichment.
        chefs_for_llm = [
            {
                "chef_id": c["chef_id"],
                "full_name": c.get("full_name"),
                "cuisines": c.get("cuisines"),
                "average_rating": c.get("average_rating"),
                "base_rate_per_person": c.get("base_rate_per_person"),
                "distance_miles": c.get("distance_miles"),
            }
            for c in chefs
        ]

        # Attach grounding context to the latest user turn only — keeps history
        # compact and lets the cached system prompt do the schema work.
        augmented_user = (
            f"<user_message>\n{user_message}\n</user_message>\n\n"
            f"<available_chefs>\n{json.dumps(chefs_for_llm, default=str)}\n</available_chefs>\n\n"
            f"<pricing_context>\n{json.dumps(pricing_ctx, default=str)}\n</pricing_context>"
        )
        messages = history + [{"role": "user", "content": augmented_user}]

        # Always use the fast model for chat — Sonnet on a fresh full plan was
        # consistently exceeding the 30s gunicorn worker timeout.
        plan, usage = call_llm(messages, model=FAST_MODEL)

        if isinstance(plan, dict) and not plan.get("_parse_error"):
            plan = _rerank_with_ml(plan, latitude or 0.0, longitude or 0.0)

        # Persist the raw user message and the model's JSON response.
        _persist_message(conn, conversation_id, "user", user_message)
        _persist_message(conn, conversation_id, "assistant", json.dumps(plan))

        # Persist the plan record on the first turn so it can later be booked.
        # Skip refusal/clarification turns — they have no real plan content and
        # would just leave junk rows in event_plans.
        skip_statuses = {"needs_more_info", "not_culinary"}
        if (
            is_new
            and isinstance(plan, dict)
            and not plan.get("_parse_error")
            and plan.get("status") not in skip_statuses
        ):
            try:
                summary = plan.get("event_summary") or {}
                _persist_plan(
                    conn, customer_id, conversation_id,
                    str(summary.get("event_date") or ""),
                    str(summary.get("cuisine") or ""),
                    int(summary.get("guest_count") or 0),
                    plan, usage,
                )
            except Exception as e:
                print(f"[menu_planner] persist plan warning: {e}")

        ui_plan, content = _to_ui_response(plan, chefs)

        return {
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": content,
            "plan": ui_plan,
        }
    finally:
        conn.close()


def get_plan(plan_id: int) -> dict | None:
    """Fetch a saved plan by ID."""
    conn = get_db_connection()
    try:
        cursor = get_cursor(conn, dictionary=True)
        cursor.execute(
            "SELECT * FROM event_plans WHERE id = %s", (plan_id,)
        )
        row = cursor.fetchone()
        cursor.close()
        if not row:
            return None
        return {
            "plan_id": row["id"],
            "customer_id": row["customer_id"],
            "conversation_id": str(row["conversation_id"]),
            "event_date": row["event_date"].isoformat() if row["event_date"] else None,
            "cuisine_type": row["cuisine_type"],
            "guest_count": row["guest_count"],
            "plan": row["plan_json"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
    finally:
        conn.close()
