import openpyxl
import psycopg2
from psycopg2.extras import execute_values

DB_CONFIG = {
    "dbname": "vtec_dashboard",
    "user": "soufianesbai",
    "host": "localhost",
    "port": 5432,
}

EXCEL_PATH = "../backend/data/VTEC_Inventory_Consolidated.xlsx"

VALID_LOCATIONS = {"Meeting Room", "Storage Room", "Lab 01", "Lab 02", "Lab 03"}


def load_excel():
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb["Consolidated Inventory"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    headers = list(rows[0])
    data = rows[1:]
    return headers, data


def clean_value(v):
    if v is None:
        return None
    if isinstance(v, float):
        import math
        if math.isnan(v):
            return None
    s = str(v).strip()
    return s if s and s.lower() != "nan" else None


def migrate():
    headers, data = load_excel()

    col = {h: i for i, h in enumerate(headers)}

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # ── Categories ──────────────────────────────────────────
    categories = set()
    for row in data:
        cat = clean_value(row[col["Category"]])
        if cat:
            categories.add(cat)

    for cat in sorted(categories):
        cur.execute(
            "INSERT INTO categories (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            (cat,),
        )

    cur.execute("SELECT id, name FROM categories")
    category_map = {name: id for id, name in cur.fetchall()}

    # ── Items ────────────────────────────────────────────────
    items = []
    skipped = []

    for row in data:
        location = clean_value(row[col["Location"]])

        if location not in VALID_LOCATIONS:
            skipped.append(clean_value(row[col["Description"]]))
            continue

        part_id     = clean_value(row[col["Part ID"]])
        description = clean_value(row[col["Description"]])
        category    = clean_value(row[col["Category"]])
        sub_location = clean_value(row[col["Sub-Location"]])
        qty_found   = row[col["Qty Found"]]
        qty_needed  = row[col["Qty Needed"]]
        notes       = clean_value(row[col["Notes"]])

        qty_found   = int(qty_found) if qty_found and str(qty_found).strip() not in ("", "nan") else None
        qty_needed  = int(qty_needed) if qty_needed and str(qty_needed).strip() not in ("", "nan") else None
        category_id = category_map.get(category) if category else None
        qty_available = qty_found

        items.append((
            part_id, description, category_id, location,
            sub_location, qty_found, qty_needed, notes, qty_available
        ))

    execute_values(cur, """
        INSERT INTO items
            (part_id, description, category_id, location,
             sub_location, qty_found, qty_needed, notes, qty_available)
        VALUES %s
    """, items)

    conn.commit()
    cur.close()
    conn.close()

    print(f"Inserted {len(items)} items")
    print(f"Skipped {len(skipped)} items (no location):")
    for s in skipped:
        print(f"  - {s}")


if __name__ == "__main__":
    migrate()
