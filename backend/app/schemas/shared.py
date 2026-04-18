"""
Shared Pydantic schemas used by both admin and voter schema modules.

Types defined here avoid circular imports between admin.py and voting.py.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel


class MotionOptionOut(BaseModel):
    id: uuid.UUID
    text: str
    display_order: int

    model_config = {"from_attributes": True}
