import LeadCaptureForm from "../components/LeadCaptureForm";
import { useState } from "react";
import SEO from "../components/SEO";

const LeadCaptureCorporate = () => {
  const [teamSize, setTeamSize] = useState("");
  const [company, setCompany] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <SEO
        title="Corporate Team Outings"
        description="Book corporate team building events at A Square GoKarting. Competitive go-kart racing, custom race formats, and catering for your team."
        path="/corporate"
      />
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Corporate Team Outings</h1>
          <p className="text-lg text-gray-600">Build team spirit with competitive go-kart racing at A Square GoKarting!</p>
          <div className="mt-4 flex justify-center gap-4 text-sm text-gray-500">
            <span>Team building activities</span>
            <span>&middot;</span>
            <span>Custom race formats</span>
            <span>&middot;</span>
            <span>Catering options</span>
          </div>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Tell us about your team event</h2>
          <LeadCaptureForm
            sourceRef="corporate"
            extraFields={
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Company Name</label>
                  <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="Your company" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Team Size</label>
                  <input value={teamSize} onChange={(e) => setTeamSize(e.target.value)} type="number" min={1} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="Number of people" />
                </div>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default LeadCaptureCorporate;
