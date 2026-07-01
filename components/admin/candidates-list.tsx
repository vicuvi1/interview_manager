"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/admin/stat-card";
import { useDataChanged } from "@/lib/bus";
import { formatAmount } from "@/lib/payments";
import { STAGE_LABEL, stageTone } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import type { InterviewRequest, Payment, ProfileLite } from "@/lib/types";

interface Row {
  profile: ProfileLite;
  interviews: number;
  upcoming: number;
  paid: number;
  outstanding: number;
  lastActivity: string | null;
}

export function CandidatesList({
  adminTimezone: _adminTimezone,
  initialProfiles,
  initialRequests,
  initialPayments,
}: {
  adminTimezone: string;
  initialProfiles: ProfileLite[];
  initialRequests: InterviewRequest[];
  initialPayments: Payment[];
}) {
  const [profiles, setProfiles] = useState<ProfileLite[]>(initialProfiles);
  const [requests, setRequests] = useState<InterviewRequest[]>(initialRequests);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "activity", dir: -1 });

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: profs }, { data: reqs }, { data: pays }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, timezone, role, blocked, stage, tags, created_at"),
      supabase.from("interview_requests").select("*"),
      supabase.from("payments").select("*"),
    ]);
    if (profs) setProfiles(profs as ProfileLite[]);
    if (reqs) setRequests(reqs as InterviewRequest[]);
    if (pays) setPayments(pays as Payment[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin-candidates")
      .on("postgres_changes", { event: "*", schema: "public", table: "interview_requests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);
  useDataChanged("interviews", load);

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const byId = new Map<string, Row>();
    for (const p of profiles) {
      if (p.role === "admin") continue;
      byId.set(p.id, { profile: p, interviews: 0, upcoming: 0, paid: 0, outstanding: 0, lastActivity: p.created_at });
    }
    for (const r of requests) {
      const row = byId.get(r.candidate_id);
      if (!row) continue;
      row.interviews += 1;
      if (r.status === "scheduled" && r.scheduled_at && new Date(r.scheduled_at).getTime() >= now) row.upcoming += 1;
      if (!row.lastActivity || r.created_at > row.lastActivity) row.lastActivity = r.created_at;
    }
    for (const p of payments) {
      const row = byId.get(p.candidate_id);
      if (!row) continue;
      const amount = Number(p.amount) || 0;
      if (p.status === "paid") row.paid += amount;
      else if (p.status === "pending" || p.status === "overdue" || p.status === "partial") row.outstanding += amount;
      const stamp = p.paid_at || p.created_at;
      if (stamp && (!row.lastActivity || stamp > row.lastActivity)) row.lastActivity = stamp;
    }
    return Array.from(byId.values());
  }, [profiles, requests, payments]);

  const name = (p: ProfileLite) => p.full_name || p.email || "Candidate";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => name(r.profile).toLowerCase().includes(q) || (r.profile.email ?? "").toLowerCase().includes(q))
      : rows.slice();
    list.sort((a, b) => {
      const dir = sort.dir;
      switch (sort.key) {
        case "name":
          return dir * name(a.profile).localeCompare(name(b.profile));
        case "interviews":
          return dir * (a.interviews - b.interviews);
        case "paid":
          return dir * (a.paid - b.paid);
        case "outstanding":
          return dir * (a.outstanding - b.outstanding);
        default:
          return dir * ((a.lastActivity ?? "").localeCompare(b.lastActivity ?? ""));
      }
    });
    return list;
  }, [rows, query, sort]);

  const totals = useMemo(() => {
    return {
      candidates: rows.length,
      active: rows.filter((r) => r.upcoming > 0).length,
      paid: rows.reduce((s, r) => s + r.paid, 0),
      outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-[#f0f0f5]">Candidates</h1>
        <p className="text-[12px] text-white/40">Everyone who has signed up — click a row for the full profile.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Candidates" value={totals.candidates} icon={Users} tone="indigo" />
        <StatCard label="With upcoming" value={totals.active} icon={Users} tone="green" />
        <StatCard label="Total paid" value={formatAmount(totals.paid)} icon={Users} tone="green" />
        <StatCard label="Outstanding" value={formatAmount(totals.outstanding)} icon={Users} tone="amber" />
      </div>

      <SectionCard
        title="Directory"
        description={`${filtered.length} of ${rows.length} candidates`}
        icon={Users}
        bodyClassName="p-0 sm:p-0"
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              className="h-9 w-52 pl-9"
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Users} title="No candidates" description="No one matches your search." />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-white/40">
                  <SortTh label="Candidate" k="name" sort={sort} setSort={setSort} className="px-5 sm:px-6" />
                  <SortTh label="Interviews" k="interviews" sort={sort} setSort={setSort} />
                  <SortTh label="Total paid" k="paid" sort={sort} setSort={setSort} />
                  <SortTh label="Outstanding" k="outstanding" sort={sort} setSort={setSort} />
                  <SortTh label="Last activity" k="activity" sort={sort} setSort={setSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filtered.map((r) => (
                  <tr key={r.profile.id} className="group transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3 sm:px-6">
                      <Link href={`/admin/candidates/${r.profile.id}`} className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
                          {initials(r.profile.full_name, r.profile.email)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate font-medium text-[#f0f0f5] group-hover:text-white">{name(r.profile)}</p>
                            {r.profile.blocked ? <Badge tone="red">suspended</Badge> : null}
                            {r.profile.stage && r.profile.stage !== "applied" ? (
                              <Badge tone={stageTone(r.profile.stage)}>{STAGE_LABEL[r.profile.stage] ?? r.profile.stage}</Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-[12px] text-white/40">{r.profile.email}</p>
                          {r.profile.tags && r.profile.tags.length ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.profile.tags.slice(0, 4).map((t) => (
                                <span key={t} className="rounded-full bg-[#6366f1]/[0.12] px-1.5 py-0.5 text-[10px] text-[#c7d2fe]">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-white/80">
                      {r.interviews}
                      {r.upcoming > 0 ? (
                        <Badge tone="indigo" className="ml-2">
                          {r.upcoming} upcoming
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 tabular-nums font-medium text-[#34d399]">{formatAmount(r.paid)}</td>
                    <td className="px-3 py-3 tabular-nums text-[#fbbf24]">
                      {r.outstanding > 0 ? formatAmount(r.outstanding) : <span className="text-white/25">—</span>}
                    </td>
                    <td className="px-3 py-3 text-white/55">{r.lastActivity ? relativeTime(r.lastActivity) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function SortTh({
  label,
  k,
  sort,
  setSort,
  className,
}: {
  label: string;
  k: string;
  sort: { key: string; dir: 1 | -1 };
  setSort: (s: { key: string; dir: 1 | -1 }) => void;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2.5 font-medium", className)}>
      <button
        type="button"
        onClick={() => setSort({ key: k, dir: sort.key === k && sort.dir === -1 ? 1 : -1 })}
        className={cn("inline-flex items-center gap-1 hover:text-white/70", sort.key === k && "text-white/80")}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}
