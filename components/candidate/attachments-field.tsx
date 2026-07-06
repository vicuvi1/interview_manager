"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB each
const ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,image/*,application/pdf";

/**
 * Upload multiple files/images as attachments. Stored in the private "resumes"
 * bucket at ${userId}/att-*; only { name, path } refs are kept by the caller.
 * `readOnly` shows the list with View links but no upload/remove (admin view).
 */
export function AttachmentsField({
  userId,
  value,
  onChange,
  readOnly,
}: {
  userId: string;
  value: Attachment[];
  onChange?: (next: Attachment[]) => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    const supabase = createClient();
    const added: Attachment[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        toast({ title: `${f.name} is too large`, description: "Files must be under 5 MB.", variant: "error" });
        continue;
      }
      const ext = (f.name.split(".").pop() || "bin").toLowerCase();
      const path = `${userId}/att-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("resumes").upload(path, f, {
        upsert: false,
        contentType: f.type || "application/octet-stream",
      });
      if (error) {
        toast({ title: "Upload failed", description: error.message, variant: "error" });
        continue;
      }
      added.push({ name: f.name, path });
    }
    setUploading(false);
    if (ref.current) ref.current.value = "";
    if (added.length && onChange) onChange([...value, ...added]);
  }

  async function view(a: Attachment) {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(a.path, 60);
    if (error || !data) return toast({ title: "Couldn't open", description: error?.message, variant: "error" });
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(a: Attachment) {
    const supabase = createClient();
    await supabase.storage.from("resumes").remove([a.path]);
    if (onChange) onChange(value.filter((x) => x.path !== a.path));
  }

  return (
    <div className="space-y-2">
      {value.length ? (
        <ul className="space-y-1.5">
          {value.map((a) => (
            <li key={a.path} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
              <span className="flex-1 truncate text-[13px] text-white/80">{a.name}</span>
              <button
                type="button"
                onClick={() => view(a)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
              >
                View <ExternalLink className="h-3 w-3" />
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => remove(a)}
                  className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-[#f87171]"
                  aria-label={`Remove ${a.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : readOnly ? (
        <p className="text-[12px] text-white/40">No attachments.</p>
      ) : null}

      {!readOnly ? (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-3 text-[13px] text-white/55 transition-colors hover:border-white/25 hover:text-white/80">
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Paperclip className="h-4 w-4" /> Attach files or images (max 5 MB each)
            </>
          )}
          <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden" onChange={onFiles} disabled={uploading} />
        </label>
      ) : null}
    </div>
  );
}
