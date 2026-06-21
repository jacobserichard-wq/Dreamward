import { redirect } from "next/navigation";

// June 2026: the Expenses tab was consolidated into the Transactions view.
// Expense entry (with receipt attachments), the channel filter, and the
// expense list all live there now. This route stays as a permanent
// redirect so existing links/bookmarks land in the right place.
export default function ExpensesPage() {
  redirect("/dashboard?view=transactions");
}
