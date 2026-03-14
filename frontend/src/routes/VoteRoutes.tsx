import { Route, Routes } from "react-router-dom";
import { BuildingSelectPage } from "../pages/vote/BuildingSelectPage";
import { AuthPage } from "../pages/vote/AuthPage";
import { VotingPage } from "../pages/vote/VotingPage";
import { ConfirmationPage } from "../pages/vote/ConfirmationPage";

export function VoteRoutes() {
  return (
    <Routes>
      <Route path="/" element={<BuildingSelectPage />} />
      <Route path="/vote/:meetingId/auth" element={<AuthPage />} />
<Route path="/vote/:meetingId/voting" element={<VotingPage />} />
      <Route path="/vote/:meetingId/confirmation" element={<ConfirmationPage />} />
    </Routes>
  );
}
