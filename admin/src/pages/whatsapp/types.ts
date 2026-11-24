// Shapes of the WhatsApp Chat API (backend/src/api/routes/whatsappChat.ts).

export interface Chat {
  id: string;
  phone: string;
  name: string;
  profileName: string | null;
  customName: string | null;
  leadId: string | null;
  lastMessageAt: string;
  lastMessageText: string | null;
  unreadCount: number;
  windowOpenUntil: string | null;
  aiDraft: string | null;
  aiNote: string | null;
  pinned: boolean;
  archived: boolean;
  mutedUntil: string | null;
  labels: string[];
  notes: string | null;
  blocked: boolean;
}

export interface SharedLocation {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
  url?: string | null;
}

export interface SharedContact {
  name: string;
  phones: { phone: string; waId: string | null; type: string | null }[];
  emails?: string[];
  org?: string | null;
}

export type Interactive =
  | { type: "buttons"; body: string; header?: string | null; footer?: string | null; buttons: { id: string; title: string }[] }
  | { type: "list"; body: string; header?: string | null; footer?: string | null; button: string; sections: { title: string; rows: { id: string; title: string; description?: string | null }[] }[] }
  | { type: "cta_url"; body: string; header?: string | null; footer?: string | null; displayText: string; url: string }
  | { type: "location_request"; body: string };

export interface Message {
  id: string;
  chatId: string;
  wamid: string | null;
  direction: "in" | "out";
  type: string;
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  status: string;
  error: string | null;
  templateName: string | null;
  replyToWamid: string | null;
  forwarded: string | null;
  reactions: { in?: string; out?: string };
  payload: {
    location?: SharedLocation;
    contacts?: SharedContact[];
    choice?: { kind: string; id: string | null; title: string | null; description: string | null };
    interactive?: Interactive;
    voice?: boolean;
  } | null;
  editedAt: string | null;
  revokedAt: string | null;
  starred: boolean;
  createdAt: string;
  quoted: { id: string | null; direction: "in" | "out" | null; type: string; body: string | null } | null;
}

export interface ChatSettings {
  greetingOn: boolean;
  greetingText: string | null;
  awayOn: boolean;
  awayText: string | null;
  workStart: string;
  workEnd: string;
  workDays: number[];
  notify: boolean;
}

export interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
}

export interface BusinessProfile {
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  websites: string[];
  vertical: string | null;
  profilePictureUrl: string | null;
}

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export const PREVIEW: Record<string, string> = {
  image: "📷 Photo",
  document: "📄 Document",
  audio: "🎤 Voice message",
  video: "🎬 Video",
  sticker: "Sticker",
  location: "📍 Location",
  contacts: "👤 Contact",
  interactive: "Buttons",
  template: "Template",
};

export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
