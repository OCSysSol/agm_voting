import React from "react";
import { Routes, Route } from "react-router-dom";
import { BuildingSelectPage } from "./pages/vote/BuildingSelectPage";
import { AuthPage } from "./pages/vote/AuthPage";
import { LotSelectionPage } from "./pages/vote/LotSelectionPage";
import { VotingPage } from "./pages/vote/VotingPage";
import { ConfirmationPage } from "./pages/vote/ConfirmationPage";
import { VoterShell } from "./components/vote/VoterShell";
import AdminRoutes from "./routes/AdminRoutes";
import AGMSummaryPage from "./pages/AGMSummaryPage";

export default function App() {
  return (
    <Routes>
      {/* Lot owner voting routes — wrapped in shared header shell */}
      <Route element={<VoterShell />}>
        <Route path="/" element={<BuildingSelectPage />} />
        <Route path="/vote/:agmId/auth" element={<AuthPage />} />
        <Route path="/vote/:agmId/lot-selection" element={<LotSelectionPage />} />
        <Route path="/vote/:agmId/voting" element={<VotingPage />} />
        <Route path="/vote/:agmId/confirmation" element={<ConfirmationPage />} />
      </Route>

      {/* Public AGM summary page */}
      <Route path="/agm/:agmId/summary" element={<AGMSummaryPage />} />

      {/* Admin routes */}
      <Route path="/admin/*" element={<AdminRoutes />} />
    </Routes>
  );
}
