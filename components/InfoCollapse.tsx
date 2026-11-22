import React, { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import type { QuoteDataClassification } from "../types";

export function getClassificationDisplay(classification?: QuoteDataClassification | string): {
  label: string;
  toneClass: string;
} {
  switch (classification) {
    case "LIVE":
      return { label: "LIVE 实时", toneClass: "text-emerald-400" };
    case "DELAYED":
      return { label: "DELAYED 延迟", toneClass: "text-amber-400" };
    case "HISTORICAL":
      return { label: "HISTORICAL", toneClass: "text-amber-300" };
    case "SIMULATION":
      return { label: "SIMULATION 仿真", toneClass: "text-sky-400" };
    default:
      return { label: "--", toneClass: "text-slate-400" };
  }
}

interface CollapsibleSectionProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  badge,
  defaultOpen = false,
  headerRight,
  children,
}) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left text-sm font-semibold text-slate-100 hover:text-white cursor-pointer"
        >
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
          <span>{title}</span>
          {badge && (
            <span className="text-xs font-mono font-normal text-slate-400 ml-1">{badge}</span>
          )}
        </button>
        {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
      </div>
      {open && <div className="border-t border-slate-800">{children}</div>}
    </div>
  );
};

interface InfoTipProps {
  text: string;
  label?: string;
}

export const InfoTip: React.FC<InfoTipProps> = ({ text, label = "说明" }) => {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        aria-label={label}
        title={text}
        className="p-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-60 p-2.5 rounded-lg bg-slate-900 border border-slate-700 shadow-xl text-[11px] leading-relaxed text-slate-200 whitespace-normal pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
};
