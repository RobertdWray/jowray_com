import { EnterForm } from "../enter-form";

// Static: reads nothing at request time. The key arrives in the link's fragment
// (never sent to a server) and is handed to the enterAdmin Server Function by
// the form; that function sets the cookie and redirects to /admin.
export const maxDuration = 30;

export default function AdminEnterPage() {
  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <h1 className="font-display text-h2-sm font-bold">Family admin</h1>
      <EnterForm />
    </section>
  );
}
