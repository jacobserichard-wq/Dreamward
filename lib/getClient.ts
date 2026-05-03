import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrCreateClient } from "@/lib/db";

export async function getSessionClient() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return null;
  }
  const client = await getOrCreateClient(session.user.email);
  return client;
}