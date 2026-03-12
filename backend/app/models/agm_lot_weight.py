import enum
import uuid

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class FinancialPositionSnapshot(str, enum.Enum):
    normal = "normal"
    in_arrear = "in_arrear"


class AGMLotWeight(Base):
    __tablename__ = "agm_lot_weights"
    __table_args__ = (
        UniqueConstraint("agm_id", "lot_owner_id", name="uq_agm_lot_weights_agm_lot"),
        CheckConstraint(
            "unit_entitlement_snapshot >= 0",
            name="ck_agm_lot_weights_entitlement_nonneg",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    agm_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agms.id", ondelete="CASCADE"),
        nullable=False,
    )
    lot_owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lot_owners.id", ondelete="CASCADE"),
        nullable=False,
    )
    unit_entitlement_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    financial_position_snapshot: Mapped[FinancialPositionSnapshot] = mapped_column(
        Enum(FinancialPositionSnapshot, name="financialpositionsnapshot"),
        nullable=False,
        default=FinancialPositionSnapshot.normal,
        server_default=FinancialPositionSnapshot.normal.value,
    )

    # Relationships
    agm: Mapped["AGM"] = relationship(  # noqa: F821
        "AGM", back_populates="agm_lot_weights"
    )
    lot_owner: Mapped["LotOwner"] = relationship(  # noqa: F821
        "LotOwner", back_populates="agm_lot_weights"
    )
