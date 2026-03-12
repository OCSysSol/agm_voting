import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { addLotOwner, updateLotOwner } from "../../api/admin";
import type { LotOwner } from "../../types";
import type { LotOwnerCreateRequest, LotOwnerUpdateRequest } from "../../api/admin";

interface LotOwnerFormProps {
  buildingId: string;
  editTarget: LotOwner | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function LotOwnerForm({
  buildingId,
  editTarget,
  onSuccess,
  onCancel,
}: LotOwnerFormProps) {
  const isEdit = editTarget !== null;

  const [lotNumber, setLotNumber] = useState(editTarget?.lot_number ?? "");
  // In add mode: single email input for the first email address
  const [email, setEmail] = useState(editTarget?.emails?.[0] ?? "");
  const [unitEntitlement, setUnitEntitlement] = useState(
    editTarget?.unit_entitlement.toString() ?? ""
  );
  const [financialPosition, setFinancialPosition] = useState(
    editTarget?.financial_position ?? "normal"
  );
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setLotNumber(editTarget?.lot_number ?? "");
    setEmail(editTarget?.emails?.[0] ?? "");
    setUnitEntitlement(editTarget?.unit_entitlement.toString() ?? "");
    setFinancialPosition(editTarget?.financial_position ?? "normal");
    setFormError(null);
  }, [editTarget]);

  const addMutation = useMutation<LotOwner, Error, LotOwnerCreateRequest>({
    mutationFn: (data) => addLotOwner(buildingId, data),
    onSuccess: () => {
      setLotNumber("");
      setEmail("");
      setUnitEntitlement("");
      setFormError(null);
      onSuccess();
    },
    onError: (err) => { setFormError(err.message); },
  });

  const editMutation = useMutation<LotOwner, Error, LotOwnerUpdateRequest>({
    mutationFn: (data) => updateLotOwner(editTarget!.id, data),
    onSuccess: () => { setFormError(null); onSuccess(); },
    onError: (err) => { setFormError(err.message); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = parseInt(unitEntitlement, 10);
    if (!unitEntitlement.trim() || isNaN(parsed)) {
      setFormError("Unit entitlement must be a valid integer.");
      return;
    }
    if (parsed < 0) {
      setFormError("Unit entitlement must be >= 0.");
      return;
    }

    if (isEdit) {
      const updateData: LotOwnerUpdateRequest = {};
      if (parsed !== editTarget!.unit_entitlement) updateData.unit_entitlement = parsed;
      if (financialPosition !== editTarget!.financial_position) updateData.financial_position = financialPosition;
      if (Object.keys(updateData).length === 0) {
        setFormError("No changes detected.");
        return;
      }
      editMutation.mutate(updateData);
    } else {
      if (!lotNumber.trim()) { setFormError("Lot number is required."); return; }
      if (!email.trim()) { setFormError("Email is required."); return; }
      addMutation.mutate({ lot_number: lotNumber, emails: [email], unit_entitlement: parsed, financial_position: financialPosition });
    }
  }

  const isPending = addMutation.isPending || editMutation.isPending;

  return (
    <div className="admin-card" style={{ marginBottom: 24 }}>
      <div className="admin-card__header">
        <h3 className="admin-card__title">{isEdit ? "Edit Lot Owner" : "Add Lot Owner"}</h3>
      </div>
      <div className="admin-card__body">
        <form onSubmit={handleSubmit} className="admin-form">
          {!isEdit && (
            <div className="field">
              <label className="field__label" htmlFor="lot-number">Lot Number</label>
              <input
                id="lot-number"
                className="field__input"
                type="text"
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
              />
            </div>
          )}

          {!isEdit && (
            <div className="field">
              <label className="field__label" htmlFor="lot-email">Email</label>
              <input
                id="lot-email"
                className="field__input"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="lot-entitlement">Unit Entitlement</label>
            <input
              id="lot-entitlement"
              className="field__input"
              type="number"
              value={unitEntitlement}
              onChange={(e) => setUnitEntitlement(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="lot-financial-position">Financial Position</label>
            <select
              id="lot-financial-position"
              className="field__input"
              value={financialPosition}
              onChange={(e) => setFinancialPosition(e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="in_arrear">In Arrear</option>
            </select>
          </div>

          {formError && (
            <p className="field__error" style={{ marginBottom: 12 }}>{formError}</p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn btn--primary" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save Changes" : "Add Lot Owner"}
            </button>
            <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={isPending}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
