"""
Prompt builder for capability 1: full event plan (menu + ingredients + cost + chefs).

build_messages(context) -> list[dict]  (Claude messages array)
"""

import json
from services.prompts.system_prompt import get_system_block

# Two hand-crafted few-shot examples baked into the user turn for grounding.
FEW_SHOT_EXAMPLES = """
## Example 1 – Jamaican dinner for 12

Request:
<event_request>
cuisine: Jamaican, guests: 12, dietary: none, date: 2026-06-15
</event_request>

Response (abbreviated):
{
  "status": "complete",
  "clarifying_question": null,
  "event_summary": {"cuisine": "Jamaican", "guest_count": 12, "dietary_notes": []},
  "menu": [
    {"course": "appetizer", "dish": "Jerk Chicken Wings", "rationale": "Classic Jamaican starter that pairs well with rum punch.", "serves": 12},
    {"course": "main", "dish": "Oxtail Stew", "rationale": "Rich, slow-cooked centerpiece of Jamaican Sunday cooking.", "serves": 12},
    {"course": "side", "dish": "Rice and Peas", "rationale": "Traditional accompaniment that balances the stew.", "serves": 12},
    {"course": "dessert", "dish": "Rum Cake", "rationale": "Iconic Caribbean dessert that guests can take home.", "serves": 12}
  ],
  "ingredients": [
    {"item": "Chicken wings", "quantity": "6", "unit": "lbs", "course": "appetizer"},
    {"item": "Scotch bonnet peppers", "quantity": "6", "unit": "peppers", "course": "appetizer"}
  ],
  "cost_estimate": {"per_person_usd": 52.00, "total_usd": 624.00, "breakdown": {"ingredients": 240.00, "chef_service": 384.00}, "confidence": "medium"},
  "recommended_chefs": [{"chef_id": 12, "match_reason": "Specializes in Caribbean cuisine with a 4.8-star rating.", "ml_score": 0.87}]
}

## Example 2 – Italian brunch for 8 (vegetarian)

Request:
<event_request>
cuisine: Italian, guests: 8, dietary: vegetarian, date: 2026-07-20
</event_request>

Response (abbreviated):
{
  "status": "complete",
  "clarifying_question": null,
  "event_summary": {"cuisine": "Italian", "guest_count": 8, "dietary_notes": ["vegetarian"]},
  "menu": [
    {"course": "appetizer", "dish": "Bruschetta al Pomodoro", "rationale": "Light tomato starter that opens the palate without meat.", "serves": 8},
    {"course": "main", "dish": "Mushroom Risotto", "rationale": "Creamy, umami-rich main that satisfies vegetarians and omnivores alike.", "serves": 8},
    {"course": "salad", "dish": "Caprese Salad", "rationale": "Classic Italian combination of mozzarella, tomato, and basil.", "serves": 8},
    {"course": "dessert", "dish": "Tiramisu", "rationale": "No gelatin or meat — a universally loved Italian finale.", "serves": 8}
  ],
  "ingredients": [
    {"item": "Arborio rice", "quantity": "2", "unit": "lbs", "course": "main"},
    {"item": "Mixed mushrooms", "quantity": "3", "unit": "lbs", "course": "main"}
  ],
  "cost_estimate": {"per_person_usd": 45.00, "total_usd": 360.00, "breakdown": {"ingredients": 120.00, "chef_service": 240.00}, "confidence": "high"},
  "recommended_chefs": [{"chef_id": 7, "match_reason": "Italian cuisine specialist with extensive vegetarian menu experience.", "ml_score": 0.91}]
}
"""


def build_messages(context: dict) -> list[dict]:
    """
    Build the Claude messages array for a full event plan.

    context keys:
        cuisine          str
        guest_count      int
        event_date       str  (ISO date)
        dietary          list[str]
        zip_code         str
        past_bookings    str  (optional summary)
        available_chefs  list[dict]  (top 20 nearby chefs from DB)
        pricing_context  list[dict]  (chef_pricing rows + multiplier)
    """
    event_request = (
        f"cuisine: {context.get('cuisine', 'any')}, "
        f"guests: {context.get('guest_count', 1)}, "
        f"dietary: {', '.join(context.get('dietary', [])) or 'none'}, "
        f"date: {context.get('event_date', 'TBD')}, "
        f"zip: {context.get('zip_code', 'N/A')}"
    )

    past_bookings_block = ""
    if context.get("past_bookings"):
        past_bookings_block = (
            f"\n<past_bookings>\n{context['past_bookings']}\n</past_bookings>"
        )

    user_content = (
        f"{FEW_SHOT_EXAMPLES}\n\n"
        f"Now plan the following event. Return ONLY valid JSON matching the schema.\n\n"
        f"<event_request>\n{event_request}\n</event_request>\n\n"
        f"<available_chefs>\n{json.dumps(context.get('available_chefs', []), indent=2)}\n</available_chefs>\n\n"
        f"<pricing_context>\n{json.dumps(context.get('pricing_context', []), indent=2)}\n</pricing_context>"
        f"{past_bookings_block}\n\n"
        "Task: generate the full event plan JSON."
    )

    return [
        {
            "role": "user",
            "content": user_content,
        }
    ]
