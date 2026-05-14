import LeadCaptureForm from "../components/LeadCaptureForm";
import { useState } from "react";
import SEO from "../components/SEO";

const LeadCaptureBirthday = () => {
  const [partySize, setPartySize] = useState("");
  const [ageGroup, setAgeGroup] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      <SEO
        title="Birthday Party Packages"
        description="Celebrate your birthday with thrilling go-kart races at A Square GoKarting. Private track sessions, party decorations, food & beverages included."
        path="/birthday"
      />
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Birthday Party Packages</h1>
          <p className="text-lg text-gray-600">Celebrate your special day with thrilling go-kart races at A Square GoKarting!</p>
          <div className="mt-4 flex justify-center gap-4 text-sm text-gray-500">
            <span>Private track sessions</span>
            <span>&middot;</span>
            <span>Party decorations</span>
            <span>&middot;</span>
            <span>Food & beverages</span>
          </div>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Tell us about your party</h2>
          <LeadCaptureForm
            sourceRef="birthday"
            extraFields={
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Party Size</label>
                    <input value={partySize} onChange={(e) => setPartySize(e.target.value)} type="number" min={1} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="Number of guests" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Age Group</label>
                    <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none">
                      <option value="">Select</option>
                      <option value="kids">Kids (5-12)</option>
                      <option value="teens">Teens (13-17)</option>
                      <option value="adults">Adults (18+)</option>
                      <option value="mixed">Mixed ages</option>
                    </select>
                  </div>
                </div>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default LeadCaptureBirthday;
