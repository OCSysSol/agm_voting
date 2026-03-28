import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class MotionOption(Base):
    __tablename__ = "motion_options"
    __table_args__ = (
        UniqueConstraint(
            "motion_id",
            "display_order",
            name="uq_motion_options_motion_display_order",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    motion_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("motions.id", ondelete="CASCADE"),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(String, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Relationship back to Motion
    motion: Mapped["Motion"] = relationship("Motion", back_populates="options")  # noqa: F821
