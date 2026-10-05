#!/usr/bin/env python3
"""Fetch today and tomorrow's SNU cafeteria menus for the static widget.

The source is the official SNU Cooperative food menu page:
https://snuco.snu.ac.kr/foodmenu/
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
SEOUL = ZoneInfo("Asia/Seoul")
MEAL_LABELS = {
    "breakfast": "아침",
    "lunch": "점심",
    "dinner": "저녁",
}
DISPLAY_RESTAURANTS = ("3식당", "두레미담", "학생회관식당")


@dataclass(frozen=True)
class RestaurantMenu:
    name: str
    breakfast: str
    lunch: str
    dinner: str


@dataclass(frozen=True)
class DisplayMenu:
    name: str
    menu: str


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


def fetch_menu_html(menu_date: date, timeout: float = 20.0) -> tuple[str, str]:
    query = urlencode({"date": menu_date.isoformat(), "orderby": "DESC"})
    url = f"{SOURCE_URL}?{query}"
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


def _duremidam_self_service_only(text: str) -> str:
    lines = text.splitlines()
    start: int | None = None
    end = len(lines)

    for index, line in enumerate(lines):
        compact = re.sub(r"\s+", "", line)
        if start is None and compact.startswith("<셀프코너>"):
            start = index
        elif start is not None and compact.startswith("<주문식메뉴>"):
            end = index
            break

    if start is None:
        return ""
    return "\n".join(lines[start:end]).strip()


def _menu_items_only(text: str) -> str:
    """Remove hours, congestion notes, and other informational footnotes."""
    return "\n".join(
        line for line in text.splitlines() if line and not line.lstrip().startswith("※")
    ).strip()


def select_display_menus(
    menus: Sequence[RestaurantMenu], meal: str
) -> list[DisplayMenu]:
    by_name = {_restaurant_base_name(menu.name): menu for menu in menus}
    missing = [name for name in DISPLAY_RESTAURANTS if name not in by_name]
    if missing:
        raise ValueError(f"Could not find required restaurants: {', '.join(missing)}")

    selected: list[DisplayMenu] = []
    for restaurant_name in DISPLAY_RESTAURANTS:
        restaurant = by_name[restaurant_name]
        value = getattr(restaurant, meal)
        if restaurant_name == "두레미담":
            value = _duremidam_self_service_only(value)
        selected.append(
            DisplayMenu(
                name=_restaurant_base_name(restaurant.name),
                menu=_menu_items_only(value),
            )
        )
    return selected


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Date must use the YYYY-MM-DD format.") from error


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--date", type=parse_date, help="first date (default: today in Seoul)"
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
        for offset in range(2):
            menu_date = first_date + timedelta(days=offset)
            html, source_url = fetch_menu_html(menu_date)
            menus = parse_menu_html(html)

            # Some restaurants may be absent from the source on holidays.
            present = {_restaurant_base_name(menu.name) for menu in menus}
            menus.extend(
                RestaurantMenu(name, "", "", "")
                for name in DISPLAY_RESTAURANTS
                if name not in present
            )
            selected = {
                meal: select_display_menus(menus, meal) for meal in MEAL_LABELS
            }
            days[menu_date.isoformat()] = {
                "source": source_url,
                "restaurants": [
                    {
                        "name": name,
                        "meals": {
                            meal: selected[meal][index].menu for meal in MEAL_LABELS
                        },
                    }
                    for index, name in enumerate(DISPLAY_RESTAURANTS)
                ],
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
