"""All SQL lives here, every read scoped to one dataset. Select lists name
exactly each dataclass's fields, so `Cls(**row)` fails loudly on drift.
"""

from dataclasses import dataclass
from datetime import date

from baseball_analyzer.db import Conn
from baseball_analyzer.metrics import SWING_THRESHOLD, Pitch

PITCH_FIELDS = """
    id, game_date, game_bam_id, at_bat_number, pitch_seq,
    pre_balls, pre_strikes, pitch_type, pitch_result,
    pitcher_pitch_no, times_through_order,
    plate_x, plate_z, strikezone_top, strikezone_bot, batter_side,
    swing, swinging_strike, in_play, bunt_attempt, hit_exit_speed, bat_speed
"""


@dataclass(frozen=True)
class DatasetColumn:
    column_name: str
    non_null_count: int
    min_value: str | None
    max_value: str | None
    is_derived: bool


@dataclass(frozen=True)
class Dataset:
    id: int
    key: str
    name: str
    source: str
    start_date: date | None
    end_date: date | None
    row_count: int
    is_reference: bool
    columns: list[DatasetColumn]


@dataclass(frozen=True)
class Batter:
    bam_id: int
    name_first: str
    name_last: str
    sides: list[str]
    pitches: int
    swings: int


@dataclass(frozen=True)
class PitchRow:  # exactly the PITCH_FIELDS columns, feeds to_pitch and /pitches JSON
    id: int
    game_date: date
    game_bam_id: int
    at_bat_number: int
    pitch_seq: int
    pre_balls: int
    pre_strikes: int
    pitch_type: str | None
    pitch_result: str | None
    pitcher_pitch_no: int | None
    times_through_order: int | None
    plate_x: float | None
    plate_z: float | None
    strikezone_top: float | None
    strikezone_bot: float | None
    batter_side: str
    swing: bool
    swinging_strike: bool
    in_play: bool
    bunt_attempt: bool
    hit_exit_speed: float | None
    bat_speed: float | None


TRAJECTORY_FIELDS = """
    id, batter_bam_id, batter_name_first, batter_name_last, batter_side,
    pitcher_bam_id, pitcher_name_first, pitcher_name_last, pitcher_side,
    pitch_type, pitch_result, pre_balls, pre_strikes, swing,
    rel_side, extension, rel_height, rel_speed, rel_angle, rel_direction,
    plate_x, plate_z, zone_time,
    hit_contact_x, hit_contact_y, hit_contact_z,
    strikezone_top, strikezone_bot
"""


@dataclass(frozen=True)
class TrajectoryRow:  # exactly the TRAJECTORY_FIELDS columns, packed by /trajectories
    id: int
    batter_bam_id: int
    batter_name_first: str | None
    batter_name_last: str | None
    batter_side: str
    pitcher_bam_id: int
    pitcher_name_first: str | None
    pitcher_name_last: str | None
    pitcher_side: str | None  # nullable in the schema, unlike batter_side
    pitch_type: str | None
    pitch_result: str | None
    pre_balls: int
    pre_strikes: int
    swing: bool
    rel_side: float
    extension: float
    rel_height: float
    rel_speed: float
    rel_angle: float
    rel_direction: float
    plate_x: float
    plate_z: float
    zone_time: float
    hit_contact_x: float | None
    hit_contact_y: float | None
    hit_contact_z: float | None
    strikezone_top: float | None
    strikezone_bot: float | None


@dataclass(frozen=True)
class BaselineRow:
    metric: str
    split: str
    n_players: int
    n_events: int
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    source_key: str
    source_name: str
    source_start: date | None
    source_end: date | None


_DATASET_FIELDS = "id, key, name, source, start_date, end_date, row_count, is_reference"

# One definition of "game order": the pitch list and the trajectory replay
# must sort identically.
_GAME_ORDER = "game_date, game_bam_id, at_bat_number, pitch_seq"


def get_dataset(conn: Conn, key: str) -> Dataset | None:
    row = conn.execute(f"select {_DATASET_FIELDS} from dataset where key = %s", (key,)).fetchone()
    return Dataset(**row, columns=[]) if row is not None else None


def list_datasets(conn: Conn) -> list[Dataset]:
    dataset_rows = conn.execute(f"select {_DATASET_FIELDS} from dataset order by key").fetchall()
    column_rows = conn.execute(
        "select dataset_id, column_name, non_null_count, min_value, max_value, is_derived "
        "from dataset_column order by dataset_id, column_name"
    ).fetchall()
    return [
        Dataset(
            **row,
            columns=[
                DatasetColumn(**{k: v for k, v in c.items() if k != "dataset_id"})
                for c in column_rows
                if c["dataset_id"] == row["id"]
            ],
        )
        for row in dataset_rows
    ]


def list_batters(conn: Conn, dataset_id: int) -> list[Batter]:
    """Batters clearing the swing threshold, most swings first."""
    rows = conn.execute(
        """
        select batter_bam_id as bam_id,
               max(batter_name_first) as name_first,
               max(batter_name_last) as name_last,
               array_agg(distinct batter_side) as sides,
               count(*) as pitches,
               count(*) filter (where swing) as swings
        from pitch
        where dataset_id = %s and is_pitch
        group by batter_bam_id
        having count(*) filter (where swing) >= %s
        order by swings desc
        """,
        (dataset_id, SWING_THRESHOLD),
    ).fetchall()
    return [Batter(**r) for r in rows]


def batter_pitch_rows(
    conn: Conn,
    dataset_id: int,
    batter_bam_id: int,
    first_time_through_only: bool = False,
) -> list[PitchRow]:
    """One batter's pitches in game order."""
    tto_clause = "and times_through_order = 1" if first_time_through_only else ""
    rows = conn.execute(
        f"""
        select {PITCH_FIELDS}
        from pitch
        where dataset_id = %s and batter_bam_id = %s and is_pitch {tto_clause}
        order by {_GAME_ORDER}
        """,
        (dataset_id, batter_bam_id),
    ).fetchall()
    return [PitchRow(**r) for r in rows]


def trajectory_rows(conn: Conn, dataset_id: int) -> list[TrajectoryRow]:
    """Every pitch with all nine reconstruction inputs, in game order.

    On padres_july2024 the nine are populated on all 6,431 pitch rows, so the
    filter drops nothing there; on an exported Savant dataset it drops
    everything, which is the showcase's disabled state.
    """
    rows = conn.execute(
        f"""
        select {TRAJECTORY_FIELDS}
        from pitch
        where dataset_id = %s and is_pitch
          and rel_side is not null and extension is not null and rel_height is not null
          and rel_speed is not null and rel_angle is not null and rel_direction is not null
          and plate_x is not null and plate_z is not null and zone_time is not null
        order by {_GAME_ORDER}
        """,
        (dataset_id,),
    ).fetchall()
    return [TrajectoryRow(**r) for r in rows]


def list_baselines(conn: Conn) -> list[BaselineRow]:
    """Baseline rows with their source dataset's key, name and window."""
    rows = conn.execute(
        """
        select b.metric, b.split, b.n_players, b.n_events,
               b.p10, b.p25, b.p50, b.p75, b.p90,
               d.key as source_key, d.name as source_name,
               d.start_date as source_start, d.end_date as source_end
        from baseline b join dataset d on d.id = b.source_dataset_id
        """
    ).fetchall()
    return [BaselineRow(**r) for r in rows]


def to_pitch(row: PitchRow) -> Pitch:
    return Pitch(
        plate_x=row.plate_x,
        plate_z=row.plate_z,
        strikezone_top=row.strikezone_top,
        strikezone_bot=row.strikezone_bot,
        batter_side=row.batter_side,
        pre_strikes=row.pre_strikes,
        swing=row.swing,
        swinging_strike=row.swinging_strike,
        in_play=row.in_play,
        bunt_attempt=row.bunt_attempt,
        hit_exit_speed=row.hit_exit_speed,
        bat_speed=row.bat_speed,
    )
