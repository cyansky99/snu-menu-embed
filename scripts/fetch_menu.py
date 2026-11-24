#!/usr/bin/env python3
"""Fetch yesterday, today, and tomorrow's menus for adjacent-meal navigation.

Sources are the official SNU Cooperative and residence hall food menu pages:
https://snuco.snu.ac.kr/foodmenu/
https://snudorm.snu.ac.kr/foodmenu/
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Sequence
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


SOURCE_URL = "https://snuco.snu.ac.kr/foodmenu/"
DORM_SOURCE_URL = "https://snudorm.snu.ac.kr/foodmenu/"
SEOUL = ZoneInfo("Asia/Seoul")
EXCLUDED_RESTAURANTS = {"버거운버거", "공대간이식당", "75-1동 4층 푸드코트", "220동식당"}
MEAL_LABELS = {
    "breakfast": "아침",
    "lunch": "점심",
    "dinner": "저녁",
}


@dataclass(frozen=True)
class RestaurantMenu:
    name: str
    breakfast: str
    lunch: str
    dinner: str


def _class_names(attributes: list[tuple[str, str | None]]) -> set[str]:
    value = dict(attributes).get("class") or ""
    return set(value.split())


def _normalize_text(parts: list[str]) -> str:
    text = "".join(parts).replace("\xa0", " ")
    lines: list[str] = []

    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if line and (not lines or lines[-1] != line):
            lines.append(line)

    return "\n".join(lines)


class MenuTableParser(HTMLParser):
    """Parse only the official menu table, ignoring the surrounding WordPress page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found_menu_root = False
        self.found_menu_table = False
        self._in_menu_table = False
        self._in_tbody = False
        self._in_row = False
        self._cell_name: str | None = None
        self._cell_parts: list[str] = []
        self._row: dict[str, str] = {}
        self.rows: list[RestaurantMenu] = []

    def handle_starttag(
        self, tag: str, attributes: list[tuple[str, str | None]]
    ) -> None:
        attrs = dict(attributes)

        if not self.found_menu_root and tag == "div" and attrs.get("id") == "celeb-mealtable":
            self.found_menu_root = True
            return

        if (
            self.found_menu_root
            and not self.found_menu_table
            and tag == "table"
            and "menu-table" in _class_names(attributes)
        ):
            self.found_menu_table = True
            self._in_menu_table = True
            return

        if self._in_menu_table and tag == "tbody":
            self._in_tbody = True
        elif self._in_tbody and tag == "tr":
            self._in_row = True
            self._row = {}
        elif self._in_row and tag == "td":
            cell_classes = _class_names(attributes)
            self._cell_name = next(
                (name for name in ("title", "breakfast", "lunch", "dinner") if name in cell_classes),
                None,
            )
            self._cell_parts = []
        elif self._cell_name and tag == "br":
            self._cell_parts.append("\n")

    def handle_startendtag(
        self, tag: str, attributes: list[tuple[str, str | None]]
    ) -> None:
        if self._cell_name and tag == "br":
            self._cell_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._cell_name:
            self._cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._cell_name and tag == "td":
            self._row[self._cell_name] = _normalize_text(self._cell_parts)
            self._cell_name = None
            self._cell_parts = []

        if self._in_row and tag == "tr":
            self._in_row = False
            name = self._row.get("title", "")
            if name:
                self.rows.append(
                    RestaurantMenu(
                        name=name,
                        breakfast=self._row.get("breakfast", ""),
                        lunch=self._row.get("lunch", ""),
                        dinner=self._row.get("dinner", ""),
                    )
                )
            self._row = {}

        if self._in_tbody and tag == "tbody":
            self._in_tbody = False

        if self._in_menu_table and tag == "table":
            self._in_menu_table = False


def parse_menu_html(html: str) -> list[RestaurantMenu]:
    parser = MenuTableParser()
    parser.feed(html)
    parser.close()

    if not parser.found_menu_table:
        raise ValueError("Could not find the menu table on the source page.")
    if not parser.rows:
        raise ValueError("The menu table did not contain any restaurant data.")

    return parser.rows


def fetch_menu_html(
    menu_date: date, timeout: float = 20.0, *, source_url: str = SOURCE_URL
) -> tuple[str, str]:
    query = urlencode({"date": menu_date.isoformat(), "orderby": "DESC"})
    url = f"{source_url}?{query}"
    request = Request(
        url,
        headers={
            "User-Agent": "snu-menu-embed/0.1 (+GitHub Actions menu fetcher)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
    )

    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace"), url


def _restaurant_base_name(name: str) -> str:
    return re.sub(r"\s*\(\d{3,4}-\d{4}\)\s*$", "", name).strip()


def parse_ourhome_menu(html: str) -> RestaurantMenu:
    for restaurant in parse_menu_html(html):
        if re.sub(r"\s+", "", restaurant.name) == "아워홈(901동)":
            return RestaurantMenu("아워홈", restaurant.breakfast, restaurant.lunch, restaurant.dinner)
    raise ValueError("Could not find Ourhome (901) on the residence hall menu page.")


OPERATING_HOURS_LINE = re.compile(r"^\s*※?\s*운영\s*시간")
CONGESTION_LINE = re.compile(r"^\s*※?\s*혼잡\s*시간")
OPERATING_HOURS_RANGE = re.compile(
    r"^\s*※?\s*운영\s*시간\s*[:：]?\s*"
    r"([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*[~～–-]\s*"
    r"([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*$"
)
UNTIL_SOLD_OUT = re.compile(
    r"^\s*※?\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*[~～–-]\s*"
    r"준비\s*수량\s*소진\s*시\s*까지\s*$"
)


def operating_hours(restaurant: RestaurantMenu, meal: str) -> str:
    """Return one unambiguous range; retain corner-specific/unknown hours in text."""
    if _restaurant_base_name(restaurant.name) == "301동식당" and meal == "breakfast":
        matches = [UNTIL_SOLD_OUT.fullmatch(line)
                   for line in restaurant.breakfast.splitlines()]
        starts = {f"{int(match[1]):02}:{int(match[2]):02}" for match in matches if match}
        if len(starts) == 1:
            return f"{next(iter(starts))} – 소진 시"
    lines = [line for line in getattr(restaurant, meal).splitlines()
             if OPERATING_HOURS_LINE.match(line)]
    ranges = set()
    for line in lines:
        match = OPERATING_HOURS_RANGE.fullmatch(line)
        if not match:
            return ""
        start_h, start_m, end_h, end_m = map(int, match.groups())
        ranges.add(f"{start_h:02}:{start_m:02} – {end_h:02}:{end_m:02}")
    return next(iter(ranges)) if len(ranges) == 1 else ""


def clean_menu_text(restaurant: RestaurantMenu, meal: str) -> str:
    name = _restaurant_base_name(restaurant.name)
    text = "\n".join(line for line in getattr(restaurant, meal).splitlines()
                     if not CONGESTION_LINE.match(line))
    if name == "아워홈" and meal == "breakfast":
        # Split food lists, preserving numeric commas such as 5,000원.
        text = "\n".join(
            part.strip()
            for line in text.splitlines()
            for part in (re.split(r"(?<!\d),|,(?!\d)|，", line)
                         if not line.lstrip().startswith("※") else [line])
            if part.strip()
        )
    if name == "자하연식당 3층":
        text = re.sub(r"<\s*뷔페\s*특성상[^>]*>", "", text, flags=re.DOTALL)
        text = re.sub(r"<\s*\+\s*세미뷔페\s*>", "<세미뷔페>", text)
    if name == "3식당":
        text = "\n".join(line for line in text.splitlines()
                         if not ("든든한끼샐러드" in re.sub(r"\s+", "", line)
                                 and "항상채식변경가능" in re.sub(r"\s+", "", line)))
    if name == "301동식당":
        lines = []
        in_cafe = False
        for line in text.splitlines():
            heading = re.match(r"^\s*<([^>]+)>", line)
            if heading:
                in_cafe = "카페" in heading[1]
            if in_cafe:
                continue
            if meal == "lunch" and re.match(r"^\s*※\s*요일별\s*샐러드\s*종류\s*변경", line):
                continue
            if meal == "breakfast" and line.lstrip().startswith("※") and re.search(
                r"take\s*-?\s*out|학생증|수령", line, flags=re.IGNORECASE
            ):
                continue
            lines.append(line)
        text = "\n".join(lines)
    return text.strip()


def display_menu_text(restaurant: RestaurantMenu, meal: str) -> str:
    name = _restaurant_base_name(restaurant.name)
    text = clean_menu_text(restaurant, meal)
    if name == "자하연식당 3층" and meal == "dinner":
        return "\n".join(line for line in text.splitlines()
                         if not re.match(r"^\s*※\s*저녁\s*단체예약문의", line)).strip()
    if name == "두레미담":
        # Only show the self-service section, never the made-to-order menu.
        lines: list[str] = []
        in_self_service = False
        for line in text.splitlines():
            compact = re.sub(r"\s+", "", line)
            if compact.startswith("<셀프코너>"):
                in_self_service = True
            elif in_self_service and compact.startswith("<주문식메뉴>"):
                break
            if in_self_service and not line.lstrip().startswith("※"):
                lines.append(line)
        return "\n".join(lines).strip()
    if name == "학생회관식당":
        return "\n".join(
            line for line in text.splitlines()
            if not line.lstrip().startswith("※")
        ).strip()
    if operating_hours(restaurant, meal):
        return "\n".join(line for line in text.splitlines()
                         if not OPERATING_HOURS_LINE.match(line)
                         and not (name == "301동식당" and meal == "breakfast"
                                  and UNTIL_SOLD_OUT.fullmatch(line))).strip()
    return text


def menu_sections(restaurant: RestaurantMenu, meal: str) -> list[dict]:
    """Keep hours attached to their own corner, rather than merging time ranges."""
    if meal != "lunch" or _restaurant_base_name(restaurant.name) not in {
        "예술계식당", "301동식당"
    }:
        return []
    groups: list[tuple[str, list[str]]] = []
    for line in clean_menu_text(restaurant, meal).splitlines():
        if CONGESTION_LINE.match(line):
            continue
        heading = re.match(r"^\s*<([^>]+)>\s*(.*)$", line)
        if heading:
            groups.append((heading[1].strip(), []))
            if heading[2]:
                groups[-1][1].append(heading[2])
        elif groups:
            groups[-1][1].append(line)
        elif line.strip():
            return []  # Unrecognized layout: fall back to the complete menu text.

    titles = {"TAKE-OUT": "테이크아웃", "301동1층 교직원전용식당": "1층 교직원식당",
              "TAKE-OUT 카페 301동": "카페"}
    sections = []
    for title, lines in groups:
        text = "\n".join(lines)
        hours = operating_hours(RestaurantMenu("", "", text, ""), "lunch")
        menu_lines = []
        access_hours = []
        for line in lines:
            if hours and OPERATING_HOURS_LINE.match(line):
                continue
            access = re.match(r"^\s*※\s*(교직원|학생\s*및\s*대학원생)\s*이용시간\s*[:：]?\s*(.+)$", line)
            if access:
                value = operating_hours(RestaurantMenu("", "", f"운영시간: {access[2]}", ""), "lunch")
                if value:
                    access_hours.append({"label": access[1], "hours": value})
                    continue
            menu_lines.append(line)
        sections.append({"name": titles.get(title, title), "menu": "\n".join(menu_lines).strip(),
                         "hours": hours, "accessHours": access_hours})
    return sections


def build_restaurants(menus: Sequence[RestaurantMenu]) -> list[dict]:
    restaurants = []
    for restaurant in menus:
        name = _restaurant_base_name(restaurant.name)
        if name.lstrip("*").strip() in EXCLUDED_RESTAURANTS:
            continue
        meals = {meal: display_menu_text(restaurant, meal) for meal in MEAL_LABELS}
        restaurants.append({
            "name": name,
            "meals": meals,
            "hours": {meal: operating_hours(restaurant, meal) if meals[meal] else ""
                      for meal in MEAL_LABELS},
            "sections": {meal: menu_sections(restaurant, meal) for meal in MEAL_LABELS},
        })

    floor_names = ["자하연식당 2층", "자하연식당 3층"]
    floors = {r["name"]: r for r in restaurants if r["name"] in floor_names}
    if floors:
        combined = {"name": "자하연식당", "meals": {}, "hours": {}, "sections": {}}
        for meal in MEAL_LABELS:
            sections = [{"name": name.rsplit(" ", 1)[1], "menu": floors[name]["meals"][meal],
                         "hours": floors[name]["hours"][meal], "accessHours": []}
                        for name in floor_names if name in floors]
            combined["meals"][meal] = "\n".join(s["menu"] for s in sections if s["menu"])
            combined["hours"][meal] = ""
            combined["sections"][meal] = sections if combined["meals"][meal] else []
        first = next(i for i, r in enumerate(restaurants) if r["name"] in floors)
        restaurants = [r for r in restaurants if r["name"] not in floors]
        restaurants.insert(first, combined)
    return restaurants


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Date must use the YYYY-MM-DD format.") from error


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--date", type=parse_date, help="center date (default: today in Seoul)"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "menus.json",
    )
    args = parser.parse_args(argv)
    first_date = args.date or datetime.now(SEOUL).date()
    days = {}
    try:
        for offset in (-1, 0, 1):
            menu_date = first_date + timedelta(days=offset)
            html, source_url = fetch_menu_html(menu_date)
            menus = parse_menu_html(html)
            dorm_html, dorm_source_url = fetch_menu_html(menu_date, source_url=DORM_SOURCE_URL)
            ourhome = parse_ourhome_menu(dorm_html)
            restaurants = build_restaurants(menus)
            for restaurant in restaurants:
                restaurant["source"] = source_url
            dorm_restaurants = build_restaurants([ourhome])
            for restaurant in dorm_restaurants:
                restaurant["source"] = dorm_source_url

            days[menu_date.isoformat()] = {
                "source": source_url,
                "sources": {"cooperative": source_url, "dormitory": dorm_source_url},
                "restaurants": restaurants + dorm_restaurants,
            }

        payload = {
            "schemaVersion": 1,
            "fetchedAt": datetime.now(SEOUL).isoformat(timespec="seconds"),
            "days": days,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(args.output)
    except Exception as error:
        print(f"Failed to update menus: {error}", file=sys.stderr)
        return 1

    print(f"Updated {len(days)} days in {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
