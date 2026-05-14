/**
 * Temporary cleanup page: reassign leads from deleted telecallers to an active one,
 * and remove their monthly plan records.
 *
 * Access via /cleanup-telecallers in dev mode, then DELETE THIS FILE when done.
 */
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, writeBatch, doc, deleteDoc } from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { listFirestoreUsers } from "../api/users-firestore";

const DELETED_USER_IDS = ["u-telecaller", "nani"];
const LEADS_COLLECTION = "leads";
const PLANS_COLLECTION = "telecallerMonthlyPlans";

interface LeadInfo {
  id: string;
  customerName: string;
  assignedTo: string;
}

interface PlanInfo {
  id: string;
  telecallerId: string;
  monthKey: string;
}

export const CleanupDeletedTelecallers = () => {
  const [activeTelecallers, setActiveTelecallers] = useState<{ id: string; name: string }[]>([]);
  const [targetTelecaller, setTargetTelecaller] = useState("");
  const [affectedLeads, setAffectedLeads] = useState<LeadInfo[]>([]);
  const [affectedPlans, setAffectedPlans] = useState<PlanInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    listFirestoreUsers({ role: "Telecaller", status: "Active" }).then((users) => {
      const filtered = users.filter((u) => !DELETED_USER_IDS.includes(u.id));
      setActiveTelecallers(filtered.map((u) => ({ id: u.id, name: u.name })));
    });
  }, []);

  const scan = async () => {
    setLoading(true);
    setStatus("Scanning...");
    const firestore = initializeFirestore();
    if (!firestore) {
      setStatus("Firestore not initialized.");
      setLoading(false);
      return;
    }

    // Scan leads
    const leadsCol = collection(firestore, LEADS_COLLECTION);
    const leads: LeadInfo[] = [];
    for (const userId of DELETED_USER_IDS) {
      const snap = await getDocs(query(leadsCol, where("assignedTo", "==", userId)));
      snap.docs.forEach((d) => {
        const data = d.data();
        leads.push({
          id: d.id,
          customerName: String(data.customerName ?? "Unknown"),
          assignedTo: userId
        });
      });
    }
    setAffectedLeads(leads);

    // Scan monthly plans
    const plansCol = collection(firestore, PLANS_COLLECTION);
    const plans: PlanInfo[] = [];
    for (const userId of DELETED_USER_IDS) {
      const snap = await getDocs(query(plansCol, where("telecallerId", "==", userId)));
      snap.docs.forEach((d) => {
        const data = d.data();
        plans.push({
          id: d.id,
          telecallerId: userId,
          monthKey: String(data.monthKey ?? "")
        });
      });
    }
    setAffectedPlans(plans);

    setScanned(true);
    setStatus(`Found ${leads.length} leads and ${plans.length} plan records.`);
    setLoading(false);
  };

  const execute = async () => {
    if (!targetTelecaller) {
      setStatus("Select a target telecaller first.");
      return;
    }

    const confirmed = window.confirm(
      `Reassign ${affectedLeads.length} leads to "${activeTelecallers.find((t) => t.id === targetTelecaller)?.name}" and delete ${affectedPlans.length} plan records?`
    );
    if (!confirmed) return;

    setLoading(true);
    const firestore = initializeFirestore();
    if (!firestore) {
      setStatus("Firestore not initialized.");
      setLoading(false);
      return;
    }

    try {
      // Reassign leads in batches of 450
      const leadsCol = collection(firestore, LEADS_COLLECTION);
      const now = new Date().toISOString();
      for (let i = 0; i < affectedLeads.length; i += 450) {
        const batch = writeBatch(firestore);
        const chunk = affectedLeads.slice(i, i + 450);
        for (const lead of chunk) {
          batch.update(doc(leadsCol, lead.id), {
            assignedTo: targetTelecaller,
            updatedAt: now
          });
        }
        await batch.commit();
        setStatus(`Reassigned ${Math.min(i + 450, affectedLeads.length)}/${affectedLeads.length} leads...`);
      }

      // Delete plan records
      for (const plan of affectedPlans) {
        await deleteDoc(doc(firestore, PLANS_COLLECTION, plan.id));
      }

      setStatus(
        `Done! Reassigned ${affectedLeads.length} leads to ${activeTelecallers.find((t) => t.id === targetTelecaller)?.name}. Deleted ${affectedPlans.length} plan records. You can now delete this page.`
      );
      setAffectedLeads([]);
      setAffectedPlans([]);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-xl font-bold">Cleanup Deleted Telecallers</h1>
      <p className="text-sm text-muted">
        This will reassign all leads from <strong>{DELETED_USER_IDS.join(", ")}</strong> to your chosen active
        telecaller, and delete their monthly plan records.
      </p>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Reassign leads to:</label>
        <select
          className="ui-field w-full"
          value={targetTelecaller}
          onChange={(e) => setTargetTelecaller(e.target.value)}
        >
          <option value="">-- Select telecaller --</option>
          {activeTelecallers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.id})
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button className="ui-btn" onClick={scan} disabled={loading}>
          {loading ? "Scanning..." : "1. Scan for affected data"}
        </button>
        {scanned && (
          <button className="ui-btn ui-btn-danger" onClick={execute} disabled={loading || !targetTelecaller}>
            {loading ? "Processing..." : "2. Execute cleanup"}
          </button>
        )}
      </div>

      {status && (
        <div className="rounded border border-border bg-panel p-3 text-sm">
          {status}
        </div>
      )}

      {affectedLeads.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Affected leads ({affectedLeads.length})
          </summary>
          <ul className="mt-1 max-h-60 overflow-auto text-xs space-y-1">
            {affectedLeads.map((l) => (
              <li key={l.id} className="rounded bg-surface p-1">
                {l.customerName} — assigned to: {l.assignedTo} (doc: {l.id})
              </li>
            ))}
          </ul>
        </details>
      )}

      {affectedPlans.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Affected plan records ({affectedPlans.length})
          </summary>
          <ul className="mt-1 max-h-60 overflow-auto text-xs space-y-1">
            {affectedPlans.map((p) => (
              <li key={p.id} className="rounded bg-surface p-1">
                {p.telecallerId} — {p.monthKey} (doc: {p.id})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
