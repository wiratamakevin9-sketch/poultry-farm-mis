"""Symptoms a worker can tick (UC14).

These only describe what the worker saw. The system never turns them into a diagnosis;
the veterinarian decides. The list should be checked by the farm's veterinarian.
"""

SYMPTOMS: dict[str, str] = {
    "LETHARGIC": "Lesu",
    "APPETITE_DOWN": "Nafsu makan turun",
    "DRINKING_DOWN": "Minum berkurang",
    "ABNORMAL_DROPPINGS": "Diare atau kotoran tidak normal",
    "RESPIRATORY": "Ngorok atau sesak napas",
    "PALE_COMB": "Jengger/pial pucat atau kebiruan",
    "SWELLING": "Bengkak di kepala atau mata",
    "PRODUCTION_DROP": "Produksi telur turun mendadak",
    "SUDDEN_DEATH": "Kematian mendadak",
}
