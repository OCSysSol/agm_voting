import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createBuilding } from "../../api/admin";
import type { Building } from "../../types";

interface BuildingFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function BuildingForm({ onSuccess, onCancel }: BuildingFormProps) {
  const [name, setName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation<Building, Error, { name: string; manager_email: string }>({
    mutationFn: (data) => createBuilding(data),
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setFormError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) { setFormError("Building name is required."); return; }
    if (!managerEmail.trim()) { setFormError("Manager email is required."); return; }
    mutation.mutate({ name: name.trim(), manager_email: managerEmail.trim() });
  }

  return (
    <div className="admin-card">
      <div className="admin-card__header">
        <h3 className="admin-card__title">Create Building</h3>
      </div>
      <form onSubmit={handleSubmit} className="admin-form">
        {/* US-ACC-08: required field legend */}
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
          <span aria-hidden="true">*</span> Required field
        </p>
        <div className="field">
          {/* US-ACC-08: visible * marker (aria-hidden) + aria-required on input */}
          <label className="field__label field__label--required" htmlFor="building-name">Building Name</label>
          <input
            id="building-name"
            className="field__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Harbour View Tower"
            aria-required="true"
          />
        </div>
        <div className="field">
          <label className="field__label field__label--required" htmlFor="building-manager-email">Manager Email</label>
          <input
            id="building-manager-email"
            className="field__input"
            type="email"
            value={managerEmail}
            onChange={(e) => setManagerEmail(e.target.value)}
            placeholder="e.g. manager@example.com"
            aria-required="true"
          />
        </div>
        {formError && (
          <p className="field__error" style={{ marginBottom: 12 }}>{formError}</p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="submit" className="btn btn--primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating..." : "Create Building"}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={mutation.isPending}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
