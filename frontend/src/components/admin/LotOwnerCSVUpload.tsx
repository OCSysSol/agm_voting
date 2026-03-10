import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { importLotOwners } from "../../api/admin";
import type { LotOwnerImportResult } from "../../api/admin";

interface LotOwnerCSVUploadProps {
  buildingId: string;
  onSuccess: () => void;
}

export default function LotOwnerCSVUpload({ buildingId, onSuccess }: LotOwnerCSVUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [result, setResult] = useState<LotOwnerImportResult | null>(null);

  const mutation = useMutation<LotOwnerImportResult, Error, File>({
    mutationFn: (file: File) => importLotOwners(buildingId, file),
    onSuccess: (data) => {
      setResult(data);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onSuccess();
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file.name);
    setResult(null);
    mutation.reset();
    mutation.mutate(file);
  }

  return (
    <div className="admin-card">
      <div className="admin-card__header">
        <h3 className="admin-card__title">Import Lot Owners</h3>
      </div>
      <div className="admin-upload">
        <p className="admin-upload__hint">
          CSV: <code>lot_number</code>, <code>email</code>, <code>unit_entitlement</code>.
          Excel (Owners_SBT format): Lot#, UOE2, Email.
          This replaces all existing lot owners.
        </p>
        <div className="admin-upload__row">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            aria-label="Lot owners file"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="btn btn--secondary"
            style={{ fontSize: "0.8rem", padding: "7px 18px" }}
            onClick={() => fileRef.current?.click()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Uploading..." : "Choose file"}
          </button>
          {selectedFile && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              {selectedFile}
            </span>
          )}
        </div>

        {result && (
          <p className="admin-upload__result admin-upload__result--success">
            Import complete: {result.imported} records imported.
          </p>
        )}
        {mutation.isError && (
          <p className="admin-upload__result admin-upload__result--error">
            Error: {mutation.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
