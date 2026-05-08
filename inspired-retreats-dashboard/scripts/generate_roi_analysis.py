import json
from copy import deepcopy
from pathlib import Path


ROOT = Path("/Users/Pooja/Documents/New project copy/inspired-retreats-dashboard")
SOURCE_PATH = ROOT / "Data" / "performance-dashboard.json"
OUTPUT_PATH = ROOT / "Data" / "roi-analysis.json"

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
    return f"{MONTH_NAMES[int(month)][:3]} {year}"


def compact_number(value):
    value = numeric(value)
    if value >= 1_000_000:
        return f"{trim_decimal(value / 1_000_000)}M"
    if value >= 1_000:
        return f"{trim_decimal(value / 1_000)}K"
    return str(int(round(value)))


def compact_currency(value):
    value = numeric(value)
    if value >= 1_000_000:
        return f"${trim_decimal(value / 1_000_000)}M"
    if value >= 1_000:
        return f"${trim_decimal(value / 1_000)}K"
    return f"${round(value, 2):.2f}".rstrip("0").rstrip(".")


def full_currency(value):
    return "${:,.0f}".format(numeric(value))


def full_number(value):
    return "{:,.0f}".format(numeric(value))


def percent(value, digits=0):
    return f"{numeric(value) * 100:.{digits}f}%"


def trim_decimal(value):
    rounded = round(numeric(value), 1)
    return str(int(rounded)) if rounded.is_integer() else f"{rounded:.1f}"


def percent_delta(start, end):
    start = numeric(start)
    end = numeric(end)
    if start == 0:
        return 1.0 if end > 0 else 0.0
    return (end - start) / start


def sort_rows(rows):
    return sorted(rows, key=lambda row: month_key(row["year"], row["month"]))


def normalize_workbook(workbook):
    result = deepcopy(workbook)
    clients = result.get("clients", [])
    rows_by_slug = result.get("rowsByClientSlug", {})
    meta_rows = result.get("metaRowsByClientSlug", {})

    for canonical, aliases in CLIENT_ALIASES.items():
        matching = [client for client in clients if client.get("slug") in aliases]
        if not matching:
            continue
        base = next((client for client in matching if client.get("slug") == canonical), matching[0]).copy()
        base["slug"] = canonical
        clients = [client for client in clients if client.get("slug") not in aliases]
        clients.append(base)
        rows_by_slug[canonical] = sort_rows(sum((rows_by_slug.get(alias, []) for alias in aliases), []))
        meta_rows[canonical] = sort_rows(sum((meta_rows.get(alias, []) for alias in aliases), []))

    result["clients"] = sorted(clients, key=lambda client: client.get("name", ""))
    result["rowsByClientSlug"] = rows_by_slug
    result["metaRowsByClientSlug"] = meta_rows
    return result


def build_month_metrics(rows):
    row_by_key = {}
    ordered_keys = []
    for row in sort_rows(rows):
        key = month_key(row["year"], row["month"])
        row_by_key[key] = row
        if key not in ordered_keys:
            ordered_keys.append(key)

    metrics = []
    previous = None
    for key in ordered_keys:
        row = row_by_key[key]
        ig_followers = numeric(row.get("ig_followers"))
        fb_followers = numeric(row.get("fb_followers"))
        tiktok_followers = numeric(row.get("tiktok_followers"))
        total_followers = ig_followers + fb_followers + tiktok_followers
        previous_total_followers = previous["totalFollowers"] if previous else 0

        metrics.append({
            "key": key,
            "label": month_label(key),
            "shortLabel": short_label(key),
            "totalViews": numeric(row.get("total_views")),
            "igViews": numeric(row.get("ig_views")),
            "fbViews": numeric(row.get("fb_views")),
            "tiktokViews": numeric(row.get("tiktok_views")),
            "igFollowers": ig_followers,
            "fbFollowers": fb_followers,
            "tiktokFollowers": tiktok_followers,
            "totalFollowers": total_followers,
            "netNewFollowers": max(0, total_followers - previous_total_followers),
            "websiteTraffic": numeric(row.get("website_traffic")),
            "adSpend": numeric(row.get("ad_spend")),
            "newLeads": numeric(row.get("new_leads")),
            "totalLeads": numeric(row.get("ttl_leads")),
            "totalRevenue": numeric(row.get("total_booking_revenue")),
            "directRevenue": numeric(row.get("direct_booking_revenue")),
            "directSplit": numeric(row.get("direct_booking_split_pct")),
            "leadCost": numeric(row.get("cost_per_lead")),
            "bookingCost": numeric(row.get("cost_per_booking")),
            "followerCost": numeric(row.get("cost_per_follower")),
            "totalRevenueLy": numeric(row.get("ly_total_booking_revenue")),
            "directRevenueLy": numeric(row.get("ly_direct_booking_revenue")),
        })
        previous = metrics[-1]
    return metrics


def historical_window(months, selected_key):
    return [month for month in months if month["key"] <= selected_key][-3:]


def highest_month(months, field):
    return max(months, key=lambda month: numeric(month.get(field)), default=None)


def lowest_positive(months, field):
    candidates = [month for month in months if numeric(month.get(field)) > 0]
    return min(candidates, key=lambda month: numeric(month.get(field)), default=None)


def sum_metric(months, field):
    return sum(numeric(month.get(field)) for month in months)


def avg_metric(months, field):
    values = [numeric(month.get(field)) for month in months if numeric(month.get(field)) > 0]
    return (sum(values) / len(values)) if values else 0.0


def dominant_platform(month):
    views = {
        "Instagram": numeric(month.get("igViews")),
        "Facebook": numeric(month.get("fbViews")),
        "TikTok": numeric(month.get("tiktokViews")),
    }
    return max(views, key=views.get)


def choose_overview(months):
    latest = months[-1]
    previous = months[-2] if len(months) > 1 else None
    peak_revenue = highest_month(months, "totalRevenue")
    peak_views = highest_month(months, "totalViews")
    peak_split = highest_month(months, "directSplit")
    lowest_cpl = lowest_positive(months, "leadCost")
    lowest_cpb = lowest_positive(months, "bookingCost")

    candidates = []

    def add(key, label, value, note, score):
        candidates.append({
            "key": key,
            "label": label,
            "value": value,
            "note": note,
            "score": score,
        })

    revenue_note = "Peak revenue month" if peak_revenue and peak_revenue["key"] == latest["key"] else (
        f"{round(percent_delta(latest['totalRevenueLy'], latest['totalRevenue']) * 100):.0f}% above LY" if latest["totalRevenueLy"] > 0 and latest["totalRevenue"] > latest["totalRevenueLy"] else "Current month revenue"
    )
    add("totalRevenue", "Total Revenue", compact_currency(latest["totalRevenue"]), revenue_note, 95 + max(0, percent_delta(latest["totalRevenueLy"], latest["totalRevenue"])) * 20)

    split_note = "Highest direct mix" if peak_split and peak_split["key"] == latest["key"] else f"{compact_currency(latest['directRevenue'])} direct revenue"
    add("directSplit", "Direct Split", percent(latest["directSplit"], 0), split_note, 85 + latest["directSplit"] * 20)

    direct_note = f"{percent(latest['directSplit'], 0)} direct split"
    if latest["directRevenueLy"] > 0 and latest["directRevenue"] > latest["directRevenueLy"]:
        direct_note = f"{compact_currency(latest['directRevenue'] - latest['directRevenueLy'])} above LY"
    add("directRevenue", "Direct Revenue", compact_currency(latest["directRevenue"]), direct_note, 88 + max(0, percent_delta(latest["directRevenueLy"], latest["directRevenue"])) * 20)

    views_note = "Highest visibility month" if peak_views and peak_views["key"] == latest["key"] else (
        f"{round(percent_delta(previous['totalViews'], latest['totalViews']) * 100):.0f}% vs prev" if previous and previous["totalViews"] > 0 else "All platforms"
    )
    add("totalViews", "Total Views", compact_number(latest["totalViews"]), views_note, 80 + max(0, percent_delta(previous["totalViews"], latest["totalViews"])) * 15 if previous else 80)

    follower_delta = latest["totalFollowers"] - (previous["totalFollowers"] if previous else 0)
    follower_note = "Highest level to date" if latest["totalFollowers"] >= max(month["totalFollowers"] for month in months) else f"+{compact_number(follower_delta)} vs prev"
    add("totalFollowers", "Total Followers", compact_number(latest["totalFollowers"]), follower_note, 78 + max(0, percent_delta(previous["totalFollowers"], latest["totalFollowers"])) * 10 if previous else 78)

    pipeline_note = "Pipeline high" if latest["totalLeads"] >= max(month["totalLeads"] for month in months) else "Current database total"
    add("totalLeads", "Total Pipeline", compact_number(latest["totalLeads"]), pipeline_note, 75 + max(0, percent_delta(previous["totalLeads"], latest["totalLeads"])) * 10 if previous else 75)

    lead_note = f"Pipeline reached {compact_number(latest['totalLeads'])}"
    if previous and latest["newLeads"] > previous["newLeads"]:
        lead_note = f"{round(percent_delta(previous['newLeads'], latest['newLeads']) * 100):.0f}% vs prev"
    add("newLeads", "New Leads", compact_number(latest["newLeads"]), lead_note, 82 + max(0, percent_delta(previous["newLeads"], latest["newLeads"])) * 10 if previous else 82)

    traffic_note = "Period high" if latest["websiteTraffic"] >= max(month["websiteTraffic"] for month in months) else "Current month traffic"
    add("websiteTraffic", "Website Traffic", compact_number(latest["websiteTraffic"]), traffic_note, 70 + max(0, percent_delta(previous["websiteTraffic"], latest["websiteTraffic"])) * 8 if previous else 70)

    if latest["leadCost"] > 0:
        cpl_note = "Most efficient in window" if lowest_cpl and lowest_cpl["key"] == latest["key"] else "Lead efficiency held"
        add("leadCost", "Cost Per Lead", full_currency(latest["leadCost"]), cpl_note, 84 + (1 / max(latest["leadCost"], 0.01)))

    if latest["bookingCost"] > 0:
        cpb_note = "Lowest in window" if lowest_cpb and lowest_cpb["key"] == latest["key"] else "Booking efficiency"
        add("bookingCost", "Cost Per Booking", full_currency(latest["bookingCost"]), cpb_note, 83 + (1 / max(latest["bookingCost"], 0.01)))

    chosen = []
    used = set()
    for item in sorted(candidates, key=lambda item: item["score"], reverse=True):
        if item["key"] in used:
            continue
        chosen.append({k: item[k] for k in ("label", "value", "note")})
        used.add(item["key"])
        if len(chosen) == 6:
            break
    return chosen


def build_takeaways(months):
    latest = months[-1]
    first = months[0]
    previous = months[-2] if len(months) > 1 else None
    peak_revenue = highest_month(months, "totalRevenue")
    peak_views = highest_month(months, "totalViews")
    peak_split = highest_month(months, "directSplit")

    total_revenue = sum_metric(months, "totalRevenue")
    total_direct_revenue = sum_metric(months, "directRevenue")
    total_leads = sum_metric(months, "newLeads")
    direct_share = total_direct_revenue / total_revenue if total_revenue else 0
    yoy_total = sum_metric(months, "totalRevenueLy")
    yoy_direct = sum_metric(months, "directRevenueLy")
    audience_gain = latest["totalFollowers"] - first["totalFollowers"] if len(months) > 1 else latest["totalFollowers"]
    pipeline_gain = latest["totalLeads"] - first["totalLeads"] if len(months) > 1 else latest["totalLeads"]
    single_month = len(months) == 1

    if single_month:
        return [
            f"{latest['label']} generated {full_currency(latest['totalRevenue'])} in total booking revenue, giving the client a solid first benchmark.",
            f"Direct booking revenue reached {full_currency(latest['directRevenue'])}, with a {percent(latest['directSplit'], 0)} direct split so far.",
            f"Visibility reached {full_number(latest['totalViews'])} total views, led by {dominant_platform(latest)}.",
            f"Audience size reached {full_number(latest['totalFollowers'])} total followers in the first month of reporting.",
            f"Lead generation added {full_number(latest['newLeads'])} new leads and brought the pipeline to {full_number(latest['totalLeads'])}.",
            f"Website traffic reached {full_number(latest['websiteTraffic'])} sessions, creating a healthy early base to build from.",
        ]

    takeaways = []

    if peak_revenue and peak_revenue["key"] == latest["key"]:
        takeaways.append(
            f"{latest['label']} was the strongest revenue month in the window, generating {full_currency(latest['totalRevenue'])} in total booking revenue."
        )
    else:
        takeaways.append(
            f"{peak_revenue['label']} was the top revenue month at {full_currency(peak_revenue['totalRevenue'])}, while {latest['label']} closed at {full_currency(latest['totalRevenue'])}."
        )

    takeaways.append(
        f"Direct booking remained a key strength, contributing {full_currency(total_direct_revenue)} and {percent(direct_share, 0)} of total revenue across the selected range."
    )

    if peak_views and peak_views["key"] == latest["key"]:
        takeaways.append(
            f"{latest['label']} delivered the highest visibility at {full_number(latest['totalViews'])} total views, led primarily by {dominant_platform(latest)}."
        )
    else:
        takeaways.append(
            f"{peak_views['label']} delivered the highest visibility at {full_number(peak_views['totalViews'])} total views, while {latest['label']} recorded {full_number(latest['totalViews'])}."
        )

    takeaways.append(
        f"Followers grew by {full_number(max(0, audience_gain))} across the window, reaching {full_number(latest['totalFollowers'])} by {latest['label']}."
    )

    if latest["leadCost"] > 0 and first["leadCost"] > 0 and latest["leadCost"] <= first["leadCost"]:
        takeaways.append(
            f"Lead generation stayed efficient, with {full_number(total_leads)} new leads added and cost per lead improving from {full_currency(first['leadCost'])} to {full_currency(latest['leadCost'])}."
        )
    else:
        takeaways.append(
            f"The lead pipeline expanded by {full_number(max(0, pipeline_gain))}, reaching {full_number(latest['totalLeads'])} total leads by the end of the range."
        )

    if yoy_total > 0 and total_revenue > yoy_total:
        takeaways.append(
            f"Year-over-year performance stayed ahead of last year, with total revenue at {full_currency(total_revenue)} versus {full_currency(yoy_total)} and direct revenue at {full_currency(total_direct_revenue)} versus {full_currency(yoy_direct)}."
        )
    elif peak_split and peak_split["key"] == latest["key"]:
        takeaways.append(
            f"{latest['label']} also posted the strongest direct mix in the window, with a {percent(latest['directSplit'], 0)} direct booking split."
        )
    else:
        traffic_phrase = (
            f"Website traffic reached {full_number(latest['websiteTraffic'])} sessions in {latest['label']}."
            if latest["websiteTraffic"] > 0
            else f"Ad spend remained at {full_currency(sum_metric(months, 'adSpend'))} across the selected range."
        )
        takeaways.append(traffic_phrase)

    return takeaways[:6]


def build_entry(months):
    first = months[0]
    latest = months[-1]
    if len(months) == 1:
        range_label = latest["label"]
    else:
        range_label = f"{first['label']} to {latest['label']}"
    return {
        "range_label": range_label,
        "performance_overview": choose_overview(months),
        "key_takeaways": build_takeaways(months),
    }


def main():
    with SOURCE_PATH.open() as handle:
        workbook = normalize_workbook(json.load(handle))

    result = {}
    for client in workbook.get("clients", []):
        slug = client["slug"]
        metrics = build_month_metrics(workbook["rowsByClientSlug"].get(slug, []))
        roi_entries = {}
        for selected_key in TARGET_MONTHS:
            months = historical_window(metrics, selected_key)
            if not months:
                continue
            roi_entries[selected_key] = build_entry(months)
        if roi_entries:
            result[slug] = {"roi": roi_entries}

    with OUTPUT_PATH.open("w") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")

    print(f"Wrote ROI analysis for {len(result)} clients to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
