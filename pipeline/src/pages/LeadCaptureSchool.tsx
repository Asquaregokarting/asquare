import LeadCaptureForm from "../components/LeadCaptureForm";
import { useState } from "react";
import SEO from "../components/SEO";

const LeadCaptureSchool = () => {
  const [institution, setInstitution] = useState("");
  const [studentCount, setStudentCount] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <SEO
        title="School & College Group Bookings"
        description="Book group outings for students at A Square GoKarting. Group discounts, safety briefings, and supervised racing experiences."
        path="/school-groups"
      />
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">School & College Group Bookings</h1>
          <p className="text-lg text-gray-600">Give students an unforgettable racing experience at A Square GoKarting!</p>
          <div className="mt-4 flex justify-center gap-4 text-sm text-gray-500">
            <span>Group discounts</span>
            <span>&middot;</span>
            <span>Safety briefings</span>
            <span>&middot;</span>
            <span>Teacher supervision</span>
          </div>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Tell us about your group</h2>
          <LeadCaptureForm
            sourceRef="school"
            extraFields={
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Institution Name</label>
                  <input value={institution} onChange={(e) => setInstitution(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="School/college name" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Student Count</label>
                  <input value={studentCount} onChange={(e) => setStudentCount(e.target.value)} type="number" min={1} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="Number of students" />
                </div>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default LeadCaptureSchool;
