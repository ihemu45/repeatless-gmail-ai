import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import InboxApp from "@/components/InboxApp";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/");
  return <InboxApp initialEmail={session.email} />;
}
