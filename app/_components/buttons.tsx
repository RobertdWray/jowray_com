import Link from "next/link";
import type { ComponentProps } from "react";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-3 min-h-tap-lg rounded-button bg-jo-red px-[30px] py-[14px] text-[22px] font-bold text-white shadow-button-red no-underline disabled:opacity-60 disabled:shadow-none";
export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-3 min-h-tap-lg rounded-button border-[3px] border-dashed border-wood px-6 py-[14px] text-body font-bold text-walnut no-underline disabled:opacity-60 disabled:shadow-none";
export const tertiaryButtonClass =
  "inline-flex items-center justify-center gap-3 min-h-tap rounded-input bg-periwinkle-deep px-[22px] py-3 text-label font-bold text-white shadow-button-periwinkle no-underline disabled:opacity-60 disabled:shadow-none";

export function PrimaryLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={`${primaryButtonClass} ${className}`.trim()} />;
}

export function SecondaryLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={`${secondaryButtonClass} ${className}`.trim()} />;
}

export function PrimaryButton({
  type = "button",
  className = "",
  ...props
}: ComponentProps<"button">) {
  return <button {...props} type={type} className={`${primaryButtonClass} ${className}`.trim()} />;
}

export function SecondaryButton({
  type = "button",
  className = "",
  ...props
}: ComponentProps<"button">) {
  return <button {...props} type={type} className={`${secondaryButtonClass} ${className}`.trim()} />;
}

export function TertiaryButton({
  type = "button",
  className = "",
  ...props
}: ComponentProps<"button">) {
  return <button {...props} type={type} className={`${tertiaryButtonClass} ${className}`.trim()} />;
}
