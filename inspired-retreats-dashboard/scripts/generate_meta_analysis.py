import json
from copy import deepcopy
from pathlib import Path


ROOT = Path("/Users/Pooja/Documents/New project copy/inspired-retreats-dashboard")
SOURCE_PATH = ROOT / "Data" / "performance-dashboard.json"
OUTPUT_PATH = ROOT / "Data" / "meta-analysis.json"

CLIENT_ALIASES = {
    "apple-mountain": ["apple-mountain", "apple-mountain-resort"],
    "casa-oso": ["casa-oso", "casa-oso-ad-account"],
}

TARGET_MONTHS = {
    "2026-01": ("2025-11", "2026-01"),
    "2026-02": ("2025-12", "2026-02"),
    "2026-03": ("2026-01", "2026-03"),
    "2026-04": ("2026-02", "2026-04"),
}

MONTH_NAMES = {
    1: "January",
    2: "February",
    3: "March",
    4: "April",
    5: "May",
    6: "June",
    7: "July",
    8: "August",
    9: "September",
    10: "October",
    11: "November",
    12: "December",
}


def numeric(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0


def month_key(year, month):
    return f"{int(year):04d}-{int(month):02d}"


def month_label(key):
    year, month = key.split("-")
    return f"{MONTH_NAMES[int(month)]} {year}"


def short_label(key):
    year, month = key.split("-")
    return f"{MONTH_NAMES[int(month)][:3]} '{year[-2:]}"


def range_label(start_key, end_key):
    return f"{month_label(start_key)} to {month_label(end_key)}"


def trim_decimal(value):
    rounded = round(numeric(value), 1)
    return str(int(rounded)) if rounded.is_integer() else f"{rounded:.1f}"


def compact_number(value):
    value = numeric(value)
    if value >= 1_000_000:
        return f"{trim_decimal(value / 1_000_000)}M"
    if value >= 1_000:
        return f"{trim_decimal(value / 1_000)}K"
    return str(int(round(value)))


def full_number(value):
    return "{:,.0f}".format(numeric(value))


def compact_currency(value):
    value = numeric(value)
    if value >= 1_000_000:
        return f"${trim_decimal(value / 1_000_000)}M"
    if value >= 1_000:
        return f"${trim_decimal(value / 1_000)}K"
    return f"${round(value, 2):.2f}".rstrip("0").rstrip(".")


def full_currency(value):
    return "${:,.0f}".format(numeric(value))


def format_multiple(value):
    value = numeric(value)
    if abs(value - round(value)) < 0.05:
        return f"{round(value):.0f}x"
    return f"{value:.2f}x"


def format_percent(value, digits=0):
    return f"{numeric(value) * 100:.{digits}f}%"


def percent_change(previous, current):
    previous = numeric(previous)
    current = numeric(current)
    if previous <= 0:
        return 1.0 if current > 0 else 0.0
    return (current - previous) / previous


def normalize_workbook(workbook):
    result = deepcopy(workbook)
    clients = result.get("clients", [])
    roi_rows = result.get("rowsByClientSlug", {})
    meta_rows = result.get("metaRowsByClientSlug", {})

    for canonical, aliases in CLIENT_ALIASES.items():
        matching = [client for client in clients if client.get("slug") in aliases]
        if matching:
            base = next((client for client in matching if client.get("slug") == canonical), matching[0]).copy()
            base["slug"] = canonical
            clients = [client for client in clients if client.get("slug") not in aliases]
            clients.append(base)

        combined_roi = []
        combined_meta = []
        for alias in aliases:
            combined_roi.extend(roi_rows.get(alias, []))
            combined_meta.extend(meta_rows.get(alias, []))
        if combined_roi:
            roi_rows[canonical] = sorted(combined_roi, key=lambda row: month_key(row["year"], row["month"]))
        if combined_meta:
            meta_rows[canonical] = sorted(combined_meta, key=lambda row: month_key(row["year"], row["month"]))

    result["clients"] = sorted(clients, key=lambda client: client.get("name", ""))
    result["rowsByClientSlug"] = roi_rows
    result["metaRowsByClientSlug"] = meta_rows
    return result


def included_campaign(campaign_type):
    normalized = str(campaign_type or "").strip().lower()
    return "discovery" in normalized or "retarget" in normalized


def build_meta_rows(raw_rows, month_keys):
    allowed = set(month_keys)
    rows = []
    for row in raw_rows:
        key = month_key(row["year"], row["month"])
        if key not in allowed or not included_campaign(row.get("campaign_type")):
            continue
        rows.append({
            "key": key,
            "label": month_label(key),
            "shortLabel": short_label(key),
            "campaignType": row.get("campaign_type") or "Campaign",
            "spend": numeric(row.get("spend")),
            "impressions": numeric(row.get("impressions")),
            "profileVisits": numeric(row.get("profile_visits")),
            "leadsFollowers": numeric(row.get("leads_followers")),
            "igBioLeads": numeric(row.get("ig_bio_leads")),
            "bookingsEmail": numeric(row.get("bookings_email_matched")),
            "bookingsFb": numeric(row.get("bookings_fb_events")),
            "costPerBooking": numeric(row.get("cost_per_booking")),
            "avgBookingValue": numeric(row.get("avg_booking_value")),
            "revenue": numeric(row.get("revenue")),
            "roas": numeric(row.get("roas")),
            "blendedRoas": numeric(row.get("blended_roas")),
            "comments": row.get("comments") or "",
        })
    return sorted(rows, key=lambda row: (row["key"], row["campaignType"]))


def build_meta_model(rows, roi_rows):
    month_map = {}
    rows_by_campaign = {}
    for row in rows:
        month = month_map.setdefault(row["key"], {
            "key": row["key"],
            "label": row["label"],
            "shortLabel": row["shortLabel"],
            "totalSpend": 0.0,
            "attributedRevenue": 0.0,
            "blendedRoas": 0.0,
            "avgBookingValue": 0.0,
            "totalBookings": 0.0,
        })
        month["totalSpend"] += row["spend"]
        month["attributedRevenue"] += row["revenue"]
        month["blendedRoas"] = max(month["blendedRoas"], row["blendedRoas"] or row["roas"])
        month["avgBookingValue"] = max(month["avgBookingValue"], row["avgBookingValue"])
        month["totalBookings"] += row["bookingsEmail"] + row["bookingsFb"]
        rows_by_campaign.setdefault(row["campaignType"], []).append(row)

    roi_map = {month_key(row["year"], row["month"]): numeric(row.get("ad_spend")) for row in roi_rows}
    for key in ("2025-12", "2026-01"):
        if key in month_map and key in roi_map:
            month_map[key]["totalSpend"] = roi_map[key]

    months = [month_map[key] for key in sorted(month_map.keys())]
    for campaign_rows in rows_by_campaign.values():
        campaign_rows.sort(key=lambda row: row["key"])
    return months, rows_by_campaign


def highest(items, field):
    if not items:
        return None
    return max(items, key=lambda item: numeric(item.get(field)))


def lowest_positive(items, field):
    candidates = [item for item in items if numeric(item.get(field)) > 0]
    if not candidates:
        return None
    return min(candidates, key=lambda item: numeric(item.get(field)))


def sum_field(items, field):
    return sum(numeric(item.get(field)) for item in items)


def average_field(items, field):
    values = [numeric(item.get(field)) for item in items if numeric(item.get(field)) > 0]
    return (sum(values) / len(values)) if values else 0.0


def latest_nonzero(items, field):
    for item in reversed(items):
        if numeric(item.get(field)) > 0:
            return item
    return items[-1] if items else None


def best_discovery_overview(rows):
    if not rows:
        return {"label": "Discovery Reach", "value": "0", "note": "No discovery data"}
    lead_peak = highest(rows, "leadsFollowers")
    visit_peak = highest(rows, "profileVisits")
    impression_peak = highest(rows, "impressions")
    revenue_peak = highest(rows, "revenue")

    if lead_peak and numeric(lead_peak["leadsFollowers"]) > 0:
        return {
            "label": "Best Discovery Volume",
            "value": full_number(lead_peak["leadsFollowers"]),
            "note": f"{lead_peak['shortLabel']} leads/followers",
        }
    if visit_peak and numeric(visit_peak["profileVisits"]) > 0:
        return {
            "label": "Best Discovery Traffic",
            "value": compact_number(visit_peak["profileVisits"]),
            "note": f"{visit_peak['shortLabel']} page visits",
        }
    if impression_peak and numeric(impression_peak["impressions"]) > 0:
        return {
            "label": "Discovery Reach",
            "value": compact_number(impression_peak["impressions"]),
            "note": f"{impression_peak['shortLabel']} impressions",
        }
    if revenue_peak and numeric(revenue_peak["revenue"]) > 0:
        return {
            "label": "Best Discovery Month",
            "value": revenue_peak["shortLabel"],
            "note": f"{compact_currency(revenue_peak['revenue'])} attributed",
        }
    return {"label": "Best Discovery Month", "value": rows[-1]["shortLabel"], "note": "Discovery active"}


def best_retargeting_overview(rows):
    if not rows:
        return {"label": "Retargeting Results", "value": "0", "note": "No retargeting data"}
    revenue_peak = highest(rows, "revenue")
    booking_peak = highest(rows, "bookingsFb")
    roas_peak = highest(rows, "roas")
    visit_peak = highest(rows, "profileVisits")

    if revenue_peak and numeric(revenue_peak["revenue"]) > 0:
        return {
            "label": "Best Retargeting Month",
            "value": compact_currency(revenue_peak["revenue"]),
            "note": f"{revenue_peak['shortLabel']} revenue peak",
        }
    if booking_peak and numeric(booking_peak["bookingsFb"]) > 0:
        return {
            "label": "Best Retargeting Month",
            "value": full_number(booking_peak["bookingsFb"]),
            "note": f"{booking_peak['shortLabel']} FB bookings",
        }
    if roas_peak and numeric(roas_peak["roas"]) > 0:
        return {
            "label": "Best Retargeting Efficiency",
            "value": format_multiple(roas_peak["roas"]),
            "note": f"{roas_peak['shortLabel']} ROAS",
        }
    if visit_peak and numeric(visit_peak["profileVisits"]) > 0:
        return {
            "label": "Retargeting Traffic",
            "value": compact_number(visit_peak["profileVisits"]),
            "note": f"{visit_peak['shortLabel']} page visits",
        }
    return {"label": "Best Retargeting Month", "value": rows[-1]["shortLabel"], "note": "Retargeting active"}


def choose_overview(months, discovery_rows, retargeting_rows):
    if not months:
        return []
    best_month = highest(months, "attributedRevenue") or months[-1]
    peak_roas_row = highest([row for row in discovery_rows + retargeting_rows if numeric(row.get("roas") or row.get("blendedRoas")) > 0], "roas")
    if peak_roas_row is None:
        peak_roas_row = highest(discovery_rows + retargeting_rows, "blendedRoas")
    peak_roas_value = numeric(peak_roas_row.get("roas") or peak_roas_row.get("blendedRoas")) if peak_roas_row else 0
    avg_roas = average_field(months, "blendedRoas")

    overview = [
        {
            "label": "Total Revenue",
            "value": full_currency(sum_field(months, "attributedRevenue")),
            "note": "Attributed",
        },
        {
            "label": "Total Bookings",
            "value": full_number(sum_field(months, "totalBookings")),
            "note": "FB + Email",
        },
        {
            "label": "Best Month",
            "value": best_month["shortLabel"],
            "note": "Peak performance",
        },
        {
            "label": "Peak ROAS",
            "value": format_multiple(peak_roas_value),
            "note": f"{peak_roas_row['campaignType']}, {peak_roas_row['shortLabel']}" if peak_roas_row else "No ROAS data",
        },
        best_discovery_overview(discovery_rows),
        best_retargeting_overview(retargeting_rows),
    ]

    if peak_roas_value <= 0 and avg_roas > 0:
        overview[3] = {
            "label": "Blended ROAS",
            "value": format_multiple(avg_roas),
            "note": "Average efficiency",
        }

    return overview


def discovery_takeaways(window_rows):
    if not window_rows:
        return [
            "Discovery data is limited in this window, but the account still maintained a visible top-of-funnel presence."
        ]
    current = window_rows[-1]
    previous = window_rows[-2] if len(window_rows) > 1 else None
    peak_impressions = highest(window_rows, "impressions")
    peak_visits = highest(window_rows, "profileVisits")
    peak_leads = highest(window_rows, "leadsFollowers")
    peak_revenue = highest(window_rows, "revenue")
    total_visits = sum_field(window_rows, "profileVisits")
    total_leads = sum_field(window_rows, "leadsFollowers")
    total_impressions = sum_field(window_rows, "impressions")

    bullets = []
    if len(window_rows) == 1:
        bullets.append(
            f"{current['label']} delivered {full_number(current['impressions'])} impressions and {full_number(current['profileVisits'])} page visits, giving the campaign a solid reach and traffic base."
        )
        if numeric(current["leadsFollowers"]) > 0:
            bullets.append(
                f"Discovery also produced {full_number(current['leadsFollowers'])} leads and followers, helping keep new audience growth moving."
            )
        if numeric(current["revenue"]) > 0:
            bullets.append(
                f"Attributed revenue reached {full_currency(current['revenue'])}, showing the campaign supported visibility and measurable return at the same time."
            )
        bullets.append("Overall, Discovery kept new people entering the funnel and supported healthy awareness for the brand.")
        return bullets[:4]

    if peak_impressions and peak_impressions["key"] == current["key"]:
        bullets.append(
            f"{current['label']} delivered the strongest Discovery reach in the window, with {full_number(current['impressions'])} impressions and {full_number(current['profileVisits'])} page visits."
        )
    elif previous and numeric(current["impressions"]) > numeric(previous["impressions"]):
        bullets.append(
            f"{current['label']} improved Discovery reach to {full_number(current['impressions'])} impressions, up from {full_number(previous['impressions'])} in {previous['label']}."
        )
    else:
        bullets.append(
            f"{current['label']} kept Discovery active with {full_number(current['impressions'])} impressions and {full_number(current['profileVisits'])} page visits."
        )

    if peak_leads and numeric(peak_leads["leadsFollowers"]) > 0:
        if peak_leads["key"] == current["key"]:
            bullets.append(
                f"Lead and follower volume also peaked in {current['label']}, with {full_number(current['leadsFollowers'])} new actions generated from Discovery."
            )
        else:
            bullets.append(
                f"The strongest Discovery volume came in {peak_leads['label']}, generating {full_number(peak_leads['leadsFollowers'])} leads and followers and building momentum across the period."
            )

    if peak_revenue and numeric(peak_revenue["revenue"]) > 0:
        if peak_revenue["key"] == current["key"]:
            bullets.append(
                f"{current['label']} was also the best Discovery revenue month, with {full_currency(current['revenue'])} in attributed revenue and {format_multiple(current['roas'])} ROAS."
            )
        else:
            bullets.append(
                f"Discovery's strongest revenue month was {peak_revenue['label']}, returning {full_currency(peak_revenue['revenue'])} and showing that awareness activity also created measurable value."
            )

    bullets.append(
        f"Across the full {len(window_rows)}-month window, Discovery delivered {compact_number(total_impressions)} impressions, {full_number(total_visits)} page visits, and {full_number(total_leads)} leads and followers."
    )
    return bullets[:4]


def retargeting_takeaways(window_rows):
    if not window_rows:
        return [
            "Retargeting data is limited in this window, but the account still kept a conversion-focused presence live."
        ]
    current = window_rows[-1]
    previous = window_rows[-2] if len(window_rows) > 1 else None
    peak_revenue = highest(window_rows, "revenue")
    peak_bookings = highest(window_rows, "bookingsFb")
    peak_roas = highest(window_rows, "roas")
    lowest_cpb = lowest_positive(window_rows, "costPerBooking")
    total_revenue = sum_field(window_rows, "revenue")
    total_bookings = sum_field(window_rows, "bookingsFb") + sum_field(window_rows, "bookingsEmail")

    bullets = []
    if len(window_rows) == 1:
        bullets.append(
            f"{current['label']} generated {full_currency(current['revenue'])} in attributed revenue and {full_number(current['bookingsFb'] + current['bookingsEmail'])} attributed bookings from Retargeting."
        )
        bullets.append(
            f"The campaign also drove {full_number(current['profileVisits'])} page visits, showing healthy lower-funnel interest from returning audiences."
        )
        if numeric(current["roas"]) > 0:
            bullets.append(
                f"ROAS closed at {format_multiple(current['roas'])}, showing that spend translated into efficient conversion value."
            )
        bullets.append("Overall, Retargeting helped turn warm demand into bookings and measurable revenue in the current month.")
        return bullets[:4]

    if peak_revenue and peak_revenue["key"] == current["key"]:
        bullets.append(
            f"{current['label']} was the strongest Retargeting revenue month, generating {full_currency(current['revenue'])} in attributed revenue."
        )
    elif previous and numeric(current["revenue"]) > numeric(previous["revenue"]):
        bullets.append(
            f"{current['label']} improved Retargeting revenue to {full_currency(current['revenue'])}, up from {full_currency(previous['revenue'])} in {previous['label']}."
        )
    else:
        bullets.append(
            f"{current['label']} maintained Retargeting output with {full_currency(current['revenue'])} in attributed revenue."
        )

    if peak_bookings and numeric(peak_bookings["bookingsFb"]) > 0:
        current_total_bookings = numeric(current["bookingsFb"]) + numeric(current["bookingsEmail"])
        peak_total_bookings = numeric(peak_bookings["bookingsFb"]) + numeric(peak_bookings["bookingsEmail"])
        if peak_bookings["key"] == current["key"]:
            bullets.append(
                f"Booking volume also peaked in {current['label']}, with {full_number(current_total_bookings)} attributed bookings captured from warm traffic."
            )
        else:
            bullets.append(
                f"The strongest booking month was {peak_bookings['label']}, producing {full_number(peak_total_bookings)} attributed bookings and confirming steady lower-funnel demand."
            )

    if peak_roas and numeric(peak_roas["roas"]) > 0:
        bullets.append(
            f"Retargeting efficiency stayed healthy across the range, with the best ROAS landing at {format_multiple(peak_roas['roas'])} in {peak_roas['label']}."
        )

    if lowest_cpb and numeric(lowest_cpb["costPerBooking"]) > 0:
        bullets.append(
            f"The most efficient booking cost came in {lowest_cpb['label']} at {full_currency(lowest_cpb['costPerBooking'])} per booking, showing stronger conversion quality as the campaign matured."
        )
    else:
        bullets.append(
            f"Across the full {len(window_rows)}-month window, Retargeting delivered {full_currency(total_revenue)} in attributed revenue and {full_number(total_bookings)} attributed bookings."
        )
    return bullets[:4]


def performance_takeaways(months, discovery_rows, retargeting_rows):
    if not months:
        return []
    total_revenue = sum_field(months, "attributedRevenue")
    total_bookings = sum_field(months, "totalBookings")
    avg_roas = average_field(months, "blendedRoas")
    best_month = highest(months, "attributedRevenue") or months[-1]
    disc_reach = sum_field(discovery_rows, "impressions")
    disc_visits = sum_field(discovery_rows, "profileVisits")
    disc_leads = sum_field(discovery_rows, "leadsFollowers")
    ret_revenue = sum_field(retargeting_rows, "revenue")
    ret_bookings = sum_field(retargeting_rows, "bookingsFb") + sum_field(retargeting_rows, "bookingsEmail")

    if len(months) == 1:
        month = months[0]
        bullets = [
            f"Meta Ads generated {full_currency(total_revenue)} in attributed revenue in {month['label']}, showing strong paid impact in the current month.",
            f"The account also drove {full_number(total_bookings)} attributed bookings, with Retargeting helping convert demand already in market.",
        ]
        if disc_reach > 0 or disc_visits > 0:
            bullets.append(
                f"Discovery kept the top of the funnel moving with {compact_number(disc_reach)} impressions and {full_number(disc_visits)} page visits."
            )
        if avg_roas > 0:
            bullets.append(
                f"Blended ROAS held at {format_multiple(avg_roas)}, keeping overall paid efficiency in a healthy position."
            )
        return bullets[:4]

    bullets = [
        f"Meta Ads generated {full_currency(total_revenue)} in attributed revenue across the selected period, with {full_number(total_bookings)} attributed bookings in total.",
        f"{best_month['label']} was the strongest overall month, delivering {full_currency(best_month['attributedRevenue'])} in combined attributed revenue.",
    ]

    if disc_reach > 0 or disc_leads > 0:
        bullets.append(
            f"Discovery kept demand building throughout the window, contributing {compact_number(disc_reach)} impressions, {full_number(disc_visits)} page visits, and {full_number(disc_leads)} leads and followers."
        )

    if ret_revenue > 0 or ret_bookings > 0:
        bullets.append(
            f"Retargeting turned that interest into direct action, generating {full_currency(ret_revenue)} in attributed revenue and {full_number(ret_bookings)} attributed bookings."
        )
    elif avg_roas > 0:
        bullets.append(
            f"Average blended ROAS held at {format_multiple(avg_roas)}, keeping the account in a strong efficiency range over the full period."
        )

    return bullets[:4]


def build_client_analysis(client_slug, raw_meta_rows, roi_rows):
    analysis = {}
    available_keys = sorted({month_key(row["year"], row["month"]) for row in raw_meta_rows if included_campaign(row.get("campaign_type"))})
    if not available_keys:
        return analysis

    for selected_month, (start_key, end_key) in TARGET_MONTHS.items():
        if selected_month not in available_keys:
            continue
        month_keys = [key for key in available_keys if start_key <= key <= end_key]
        rows = build_meta_rows(raw_meta_rows, month_keys)
        if not rows:
            continue
        months, rows_by_campaign = build_meta_model(rows, roi_rows)
        discovery_rows = []
        retargeting_rows = []
        for campaign_type, campaign_rows in rows_by_campaign.items():
            normalized = campaign_type.lower()
            if "discovery" in normalized:
                discovery_rows.extend(campaign_rows)
            elif "retarget" in normalized:
                retargeting_rows.extend(campaign_rows)
        discovery_rows.sort(key=lambda row: row["key"])
        retargeting_rows.sort(key=lambda row: row["key"])
        analysis[selected_month] = {
            "range_label": range_label(start_key, end_key),
            "performance_overview": choose_overview(months, discovery_rows, retargeting_rows),
            "discovery_key_takeaways": discovery_takeaways(discovery_rows),
            "retargeting_key_takeaways": retargeting_takeaways(retargeting_rows),
            "performance_insights": performance_takeaways(months, discovery_rows, retargeting_rows),
        }
    return analysis


def main():
    workbook = normalize_workbook(json.loads(SOURCE_PATH.read_text()))
    output = {}
    meta_rows = workbook.get("metaRowsByClientSlug", {})
    roi_rows = workbook.get("rowsByClientSlug", {})

    for client_slug in sorted(meta_rows.keys()):
        client_analysis = build_client_analysis(client_slug, meta_rows.get(client_slug, []), roi_rows.get(client_slug, []))
        if client_analysis:
            output[client_slug] = {"meta": client_analysis}

    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"Wrote Meta analysis for {len(output)} clients to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
