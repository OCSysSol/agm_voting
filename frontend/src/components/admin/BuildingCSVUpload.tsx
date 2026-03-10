import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { importBuildings } from "../../api/admin";
import type { BuildingImportResult } from "../../api/admin";

interface BuildingCSVUploadProps {
  onSuccess: () => void;
}

export default function BuildingCSVUpload({ onSuccess }: BuildingCSVUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [result, setResult] = useState<BuildingImportResult | null>(null);

  const mutation = useMutation<BuildingImportResult, Error, File>({
    mutationFn: (file: File) => importBuildings(file),
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
        <h3 className="admin-card__title">Import Buildings</h3>
      </div>
      <div className="admin-upload">
        <p className="admin-upload__hint">
          CSV or Excel file. Required columns:{" "}
          <code>building_name</code>, <code>manager_email</code>
        </p>
        <div className="admin-upload__row">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            aria-label="Buildings file"
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
            Import complete: {result.created} created, {result.updated} updated.
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
