"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";

type Message = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeLabel, setActiveLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const labels = ["Invoices", "AR-Followup", "Expenses"];

  const fetchEmails = async (label: string) => {
    setLoading(true);
    setActiveLabel(label);
    try {
      const res = await fetch(`/api/gmail?label=${"$"}{encodeURIComponent(label)}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error("Failed to fetch emails:", err);
    }
    setLoading(false);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">FlowWork</h1>
        <p className="text-gray-400 mb-8">Accounting Automation Agency</p>

        {!session ? (
          <button
            onClick={() => signIn("google")}
            className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-medium"
          >
            Connect Gmail
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-6">
              <p className="text-gray-400">
                Connected as {session.user?.email}
              </p>
              <button
                onClick={() => signOut()}
                className="text-sm text-gray-500 hover:text-white"
              >
                Disconnect
              </button>
            </div>

            <div className="flex gap-3 mb-6">
              {labels.map((label) => (
                <button
                  key={label}
                  onClick={() => fetchEmails(label)}
                  className={`px-4 py-2 rounded-lg font-medium transition ${"$"}{
                    activeLabel === label
                      ? "bg-blue-600"
                      : "bg-gray-800 hover:bg-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading && <p className="text-gray-400">Fetching emails...</p>}

            {messages.length > 0 && (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-sm">{msg.from}</span>
                      <span className="text-xs text-gray-500">{msg.date}</span>
                    </div>
                    <p className="font-semibold mb-1">{msg.subject}</p>
                    <p className="text-sm text-gray-400">{msg.snippet}</p>
                  </div>
                ))}
              </div>
            )}

            {!loading && activeLabel && messages.length === 0 && (
              <p className="text-gray-500">No emails found with label &quot;{activeLabel}&quot;</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
