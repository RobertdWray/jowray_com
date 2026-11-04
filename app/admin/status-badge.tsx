import type { AdminMemoryStatus } from "@/lib/validations/admin";

import { STATUS_LABEL } from "./format";

const TONE: Record<AdminMemoryStatus, string> = {
  DRAFT: "border-wood bg-muslin text-walnut-soft",
  PENDING: "border-goldenrod bg-paper text-walnut",
  APPROVED: "border-lake-green bg-paper text-lake-green",
  HIDDEN: "border-plum bg-paper text-plum",
};

export function StatusBadge({ status, deleted = false }: { status: AdminMemoryStatus; deleted?: boolean }) {
  if (deleted) {
    return <span className="inline-flex items-center rounded-input border-2 border-jo-red-deep bg-paper px-3 py-1 text-small font-bold text-jo-red-deep">Deleted</span>;
  }
  return <span className={`inline-flex items-center rounded-input border-2 px-3 py-1 text-small font-bold ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}
