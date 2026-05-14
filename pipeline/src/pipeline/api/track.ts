import { apiRequest } from "./client";
import { IncidentRecord, KartRecord, QueueEntryRecord, SessionRecord } from "./types";

export const trackApi = {
  listKarts(token: string): Promise<{ karts: KartRecord[] }> {
    return apiRequest<{ karts: KartRecord[] }>("/karts", { method: "GET" }, { token });
  },
  getKart(token: string, kartId: string): Promise<{ kart: KartRecord }> {
    return apiRequest(`/karts/${kartId}`, { method: "GET" }, { token });
  },
  updateKart(
    token: string,
    kartId: string,
    payload: Partial<Pick<KartRecord, "status" | "usageHours" | "nextMaintenanceDue" | "currentSessionId">>
  ): Promise<{ kart: KartRecord }> {
    return apiRequest(
      `/karts/${kartId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  createSession(
    token: string,
    payload: {
      sessionName: string;
      startTime: string;
      duration: number;
      maxParticipants: number;
      assignedKarts: string[];
      status?: "Scheduled" | "Active" | "Completed" | "Cancelled";
    }
  ): Promise<{ session: SessionRecord }> {
    return apiRequest(
      "/sessions",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  listSessions(token: string): Promise<{ sessions: SessionRecord[] }> {
    return apiRequest<{ sessions: SessionRecord[] }>("/sessions", { method: "GET" }, { token });
  },
  getSession(token: string, sessionId: string): Promise<{ session: SessionRecord }> {
    return apiRequest(`/sessions/${sessionId}`, { method: "GET" }, { token });
  },
  updateSession(token: string, sessionId: string, payload: Partial<SessionRecord>): Promise<{ session: SessionRecord }> {
    return apiRequest(
      `/sessions/${sessionId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  listQueue(token: string): Promise<{ queue: QueueEntryRecord[] }> {
    return apiRequest("/queue", { method: "GET" }, { token });
  },
  createQueue(
    token: string,
    payload: {
      customerName: string;
      customerPhone: string;
      sessionPreference?: string;
      priority?: "Normal" | "Priority";
      estimatedWaitMinutes?: number;
    }
  ): Promise<{ queueEntry: QueueEntryRecord }> {
    return apiRequest(
      "/queue",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  updateQueue(token: string, entryId: string, payload: Partial<QueueEntryRecord>): Promise<{ queueEntry: QueueEntryRecord }> {
    return apiRequest(
      `/queue/${entryId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  deleteQueue(token: string, entryId: string): Promise<{ message: string }> {
    return apiRequest(`/queue/${entryId}`, { method: "DELETE" }, { token });
  },
  listIncidents(token: string): Promise<{ incidents: IncidentRecord[] }> {
    return apiRequest<{ incidents: IncidentRecord[] }>("/incidents", { method: "GET" }, { token });
  },
  createIncident(
    token: string,
    payload: {
      incidentType: "Minor" | "Major" | "EquipmentFailure" | "Medical";
      dateTime: string;
      kartId?: string;
      description: string;
      actionTaken: string;
      status?: "Open" | "UnderReview" | "Resolved";
    }
  ): Promise<{ incident: IncidentRecord }> {
    return apiRequest(
      "/incidents",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  updateIncident(
    token: string,
    incidentId: string,
    payload: Partial<Pick<IncidentRecord, "status" | "description" | "actionTaken">>
  ): Promise<{ incident: IncidentRecord }> {
    return apiRequest(
      `/incidents/${incidentId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      },
      { token }
    );
  }
};
