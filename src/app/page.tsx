"use client";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  History,
  ChartNoAxesCombined,
  Users,
  Building2,
  KeyRound,
  MessageSquare,
  FileChartColumn,
  ScrollText,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  Plus,
  X,
  MapPin,
  Clock,
  Check,
  ChevronRight,
  QrCode,
  Menu,
  ShieldCheck,
  Sun,
  Target,
  UserRound,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import QRCode from "qrcode";
import Link from "next/link";
import { ru, label, ui } from "@/lib/i18n";
type Row = Record<string, any>;
const icons: Record<string, typeof LayoutDashboard> = {
  today: LayoutDashboard,
  meetings: CalendarDays,
  tasks: CheckSquare,
  history: History,
  metrics: ChartNoAxesCombined,
  users: Users,
  departments: Building2,
  permissions: KeyRound,
  feedback: MessageSquare,
  reports: FileChartColumn,
  audit: ScrollText,
  profile: UserRound,
};
const date = (v: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Almaty",
  }).format(new Date(v));
const time = (v: string) =>
  v
    ? new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Almaty",
      }).format(new Date(v))
    : "—";
const full = (v: string) => (v ? date(v) + ", " + time(v) : "—");
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("SERVER_ERROR");
  }
  if (!r.ok) {
    const e = new Error(data.error ?? "SERVER_ERROR") as Error & {
      details?: any;
    };
    e.details = data.details;
    throw e;
  }
  return data;
}
const titleFor = (s: string) => ru[s as keyof typeof ru] as string;
const Button = ({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={secondary ? "button secondary" : "button"}
  >
    {children}
  </button>
);
const Field = ({
  name,
  label: caption,
  type = "text",
  required = true,
  defaultValue,
  children,
  ...props
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: any;
  children?: ReactNode;
  [k: string]: any;
}) => (
  <label className="field">
    <span>{caption}</span>
    {children ? (
      <select
        aria-label={caption}
        name={name}
        required={required}
        defaultValue={defaultValue}
        {...props}
      >
        {children}
      </select>
    ) : type === "textarea" ? (
      <textarea
        aria-label={caption}
        name={name}
        required={required}
        defaultValue={defaultValue}
        {...props}
      />
    ) : (
      <input
        aria-label={caption}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        {...props}
      />
    )}
  </label>
);
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value.toLowerCase()}>
      <i />
      {label(value)}
    </span>
  );
}
function Empty({ text = ru.empty }: { text?: string }) {
  return (
    <div className="empty">
      <Target size={28} />
      <p>{text}</p>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState<Row | null>(null),
    [ready, setReady] = useState(false),
    [section, setSection] = useState("today"),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [meetings, setMeetings] = useState<Row[]>([]),
    [tasks, setTasks] = useState<Row[]>([]),
    [departments, setDepartments] = useState<Row[]>([]),
    [users, setUsers] = useState<Row[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [report, setReport] = useState<Row>({ rows: [], metrics: {} }),
    [ownMetrics, setOwnMetrics] = useState<Row>({}),
    [dialog, setDialog] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [activation, setActivation] = useState<string | null>(null),
    [qrToken, setQrToken] = useState(""),
    [scannedMeeting, setScannedMeeting] = useState(""),
    [privateLink, setPrivateLink] = useState(""),
    [geoProgress, setGeoProgress] = useState(""),
    [filters, setFilters] = useState("");
  const geoCancelled = useRef(false),
    initialized = useRef(false),
    feedbackKey = useRef("");
  const can = useCallback(
    (p: string) =>
      !!user &&
      (user.owner || user.grants.some((g: Row) => g.permission === p)),
    [user],
  );
  const load = useCallback(async () => {
    const [ms, ts, ds, us, r] = await Promise.all([
      api("meetings"),
      api("tasks"),
      api("departments"),
      api("users"),
      api("me/attendance"),
    ]);
    setMeetings(ms);
    setTasks(ts);
    setDepartments(ds);
    setUsers(us);
    setReport(r);
    setOwnMetrics(r.metrics);
  }, []);
  useEffect(() => {
    // Strict Mode replays effects in development. Read the fragment only once:
    // the first pass removes it from history to avoid leaking the token.
    if (initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    if (window.location.pathname === "/activate") {
      setActivation(window.location.hash.slice(1));
      window.history.replaceState({}, "", "/activate");
    }
    const fragment = new URLSearchParams(url.hash.slice(1));
    const token = fragment.get("token"),
      mid = fragment.get("meeting") ?? url.searchParams.get("meeting");
    if (mid) {
      setScannedMeeting(mid);
      if (token) setQrToken(token);
      window.history.replaceState(
        {},
        "",
        "/?meeting=" + encodeURIComponent(mid),
      );
    }
    api("me")
      .then((u) => {
        setUser(u);
        return load();
      })
      .catch((e) => {
        if (e.message !== "UNAUTHENTICATED")
          setError(ru.errors[e.message as keyof typeof ru.errors] ?? ru.error);
      })
      .finally(() => setReady(true));
  }, [load]);
  useEffect(() => {
    if (scannedMeeting && user) {
      const m = meetings.find((m) => m.id === scannedMeeting);
      if (m) {
        setSelected(m);
        setDialog("meeting");
        setScannedMeeting("");
      }
    }
  }, [scannedMeeting, user, meetings]);
  useEffect(() => {
    if (!user) return;
    let path = "";
    if (section === "permissions") path = "permissions";
    if (section === "feedback") path = "feedback";
    if (section === "audit") path = "audit";
    if (section === "reports")
      path = "reports" + (filters ? "?" + filters : "");
    if (path)
      api(path)
        .then((r) => (section === "reports" ? setReport(r) : setRows(r)))
        .catch((e) =>
          setError(ru.errors[e.message as keyof typeof ru.errors] ?? ru.error),
        );
  }, [section, user, filters]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>("[role=dialog]");
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,textarea,a[href]",
        ) ?? [],
      ).filter((e) => e.offsetParent !== null);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        geoCancelled.current = true;
        setDialog("");
      }
      if (event.key === "Tab") {
        const list = focusable();
        if (!list.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [dialog, busy]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      const err = e as Error & {
        details?: Row;
      };
      setError(
        (ru.errors[err.message as keyof typeof ru.errors] ?? ru.error) +
          (err.details?.distance ? ui.distanceHint(err.details.distance) : ""),
      );
    } finally {
      setBusy(false);
    }
  };
  const navigate = (s: string) => {
    setSection(s);
    setRows([]);
    setMobile(false);
    setError("");
    setNotice("");
  };
  const open = (d: string, m: Row | null = null) => {
    setError("");
    setSelected(m);
    setDetail(null);
    setDialog(d);
    feedbackKey.current = crypto.randomUUID();
    if (d === "task" && m)
      api("tasks/" + m.id)
        .then(setDetail)
        .catch(() => setError(ru.error));
  };
  const mutation = async (
    path: string,
    method: string,
    payload: unknown,
    close = true,
  ) => {
    await api(path, method, payload);
    await load();
    if (close) setDialog("");
    setNotice(ui.s001);
  };
  const values = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(
      new FormData(e.currentTarget).entries(),
    ) as Record<string, string>;
  };
  const deptSelect = (
    <>
      <option value="">{ru.allTeam}</option>
      {departments.map((d) => (
        <option value={d.id} key={d.id}>
          {d.name}
        </option>
      ))}
    </>
  );
  const userSelect = (
    <>
      {users.map((u) => (
        <option value={u.id} key={u.id}>
          {u.display_name} · {u.login}
        </option>
      ))}
    </>
  );
  async function getPosition(): Promise<GeolocationPosition> {
    if (!navigator.geolocation) throw new Error("GEO_UNAVAILABLE");
    let last: GeolocationPositionError | undefined;
    for (let n = 0; n < 2; n++) {
      if (geoCancelled.current) throw new Error("CANCELLED");
      try {
        return await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000,
          }),
        );
      } catch (e) {
        last = e as GeolocationPositionError;
        if (last.code === 1) throw new Error("GEO_PERMISSION_DENIED");
        if (n === 0) setGeoProgress(ui.s002);
      }
    }
    throw new Error(last?.code === 3 ? "GEO_TIMEOUT" : "GEO_UNAVAILABLE");
  }
  const mark = (m: Row) =>
    run(async () => {
      geoCancelled.current = false;
      const action = m.attendance ? "check-out" : "check-in";
      try {
        setGeoProgress(ui.s003);
        const c = await api(`meetings/${m.id}/challenge`, "POST", { action });
        const p = await getPosition();
        if (geoCancelled.current) return;
        setGeoProgress(ui.s004);
        await api(`meetings/${m.id}/${action}`, "POST", {
          challenge: c.challenge,
          token: action === "check-in" ? qrToken : undefined,
          geo: {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            timestamp: p.timestamp,
          },
        });
        setNotice(action === "check-in" ? ui.s005 : ui.s006);
      } catch (e) {
        if ((e as Error).message !== "CANCELLED") throw e;
      } finally {
        setGeoProgress("");
        const fresh = await api("meetings/" + m.id);
        setSelected(fresh);
        await load();
      }
    });
  if (!ready)
    return (
      <div className="splash">
        <div className="brandmark">
          e<span>↗</span>
        </div>
        <LoaderCircle className="spin" />
        <p>{ru.loading}</p>
      </div>
    );
  if (!user)
    return (
      <div className="auth-shell">
        <div className="auth-story">
          <div className="wordmark">
            enactus<span>zhetysu</span>
          </div>
          <span className="eyebrow">{ui.s007}</span>
          <h1>
            {ui.s008}
            <br />
            {ui.s009}
            <br />
            {ui.s010}
            <em>{ui.s011}</em>
          </h1>
          <p>
            {ui.s012}
            <br />
            {ui.s013}
          </p>
          <div className="story-bottom">
            <span>ENTREPRENEURIAL · ACTION · US</span>
            <ArrowUpRight size={38} />
          </div>
        </div>
        <div className="auth-form">
          <div className="auth-card">
            <span className="mini-logo">
              ENACTUS ZHETYSU <span>↗</span>
            </span>
            <div className="icon-box">
              <ShieldCheck />
            </div>
            <h2>{activation !== null ? ui.s014 : ui.s015}</h2>
            <p className="muted">{activation !== null ? ui.s016 : ui.s017}</p>
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            {notice && <div className="success">{notice}</div>}
            <form
              onSubmit={(e) => {
                const p = values(e);
                void run(async () => {
                  if (activation !== null) {
                    await api("auth/activate", "POST", {
                      token: (p.activation_code ?? "")
                        .trim()
                        .split("#")
                        .pop()
                        ?.trim(),
                      password: p.password,
                    });
                    setActivation(null);
                    setNotice(ui.s018);
                    window.history.replaceState({}, "", "/");
                  } else {
                    await api("auth/login", "POST", p);
                    setUser(await api("me"));
                    await load();
                  }
                });
              }}
            >
              {activation === null && (
                <Field
                  name="login"
                  label={ru.login}
                  autoComplete="username"
                  placeholder={ui.s019}
                />
              )}
              {activation !== null && (
                <>
                  <p className="footnote">{ui.activationCodeHelp}</p>
                  <Field
                    name="activation_code"
                    defaultValue={activation ?? ""}
                    label={ui.activationCodeLabel}
                    type="password"
                    autoComplete="off"
                    minLength={20}
                    maxLength={500}
                    placeholder={ui.activationCodePlaceholder}
                  />
                </>
              )}
              <Field
                name="password"
                label={activation !== null ? ui.s020 : ru.password}
                type="password"
                minLength={activation !== null ? 12 : 1}
                maxLength={256}
                autoComplete={
                  activation !== null ? "new-password" : "current-password"
                }
                placeholder={ui.s021}
              />
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : activation !== null ? (
                  ui.s022
                ) : (
                  ru.signin
                )}
                <ArrowRight size={18} />
              </Button>
            </form>
            <div className="auth-help">
              <KeyRound size={16} />
              <span>
                {ui.s023}
                <br />
                {ui.s024}
              </span>
            </div>
            <p className="privacy">
              <ShieldCheck size={13} />
              {ui.s025}
            </p>
          </div>
          <span className="auth-foot">{ui.s026}</span>
        </div>
      </div>
    );
  const adminNav = [
    ["users", "users.manage"],
    ["departments", "departments.manage"],
    ["permissions", "OWNER"],
    ["feedback", "feedback.read"],
    ["reports", "attendance.read"],
    ["audit", "OWNER"],
  ].filter(([, p]) => (p === "OWNER" ? user.owner : can(p)));
  const active = meetings.find(
    (m) => m.status === "OPEN" && m.expected && !m.attendance?.check_out_at,
  );
  const upcoming = meetings
    .filter((m) => !["CANCELLED", "CLOSED", "DRAFT"].includes(m.status))
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    );
  const myTasks = tasks.filter(
    (t) => t.assigned_to === user.id && t.status !== "DONE",
  );
  const metrics = ownMetrics;
  const meetingCard = (m: Row) => (
    <button
      className="meeting-card"
      onClick={() => open("meeting", m)}
      key={m.id}
    >
      <div className="meeting-top">
        <div className="date-tile">
          <b>
            {new Date(m.starts_at).toLocaleDateString("ru-RU", {
              day: "2-digit",
              timeZone: "Asia/Almaty",
            })}
          </b>
          <span>
            {new Date(m.starts_at).toLocaleDateString("ru-RU", {
              month: "short",
              timeZone: "Asia/Almaty",
            })}
          </span>
        </div>
        <Badge value={m.status} />
      </div>
      <h3>{m.title}</h3>
      <p>
        <Clock size={14} />
        {time(m.starts_at)} – {time(m.ends_at)} <span>·</span> Asia/Almaty
      </p>
      <p>
        <MapPin size={14} />
        {m.location_label || ui.s027}
      </p>
      <div className="meeting-bottom">
        <span>
          {m.attendance
            ? ui.s028 + time(m.attendance.check_in_at)
            : m.expected
              ? ui.s029
              : ui.s030}
        </span>
        <ArrowUpRight size={19} />
      </div>
    </button>
  );
  const taskRow = (t: Row) => (
    <button className="task-row" key={t.id} onClick={() => open("task", t)}>
      <span className={"task-check " + (t.status === "DONE" ? "checked" : "")}>
        {t.status === "DONE" && <Check size={14} />}
      </span>
      <div className="task-text">
        <strong>{t.title}</strong>
        <span>
          {departments.find((d) => d.id === t.department_id)?.name || ui.s031} ·{" "}
          {t.assignee_name}
        </span>
      </div>
      <span className={"priority " + t.priority.toLowerCase()}>
        {t.priority === "HIGH"
          ? ui.s032
          : t.priority === "LOW"
            ? ui.s033
            : ui.s034}
      </span>
      <span className="task-due">{date(t.due_at)}</span>
      <Badge value={t.status} />
      <ChevronRight size={16} />
    </button>
  );
  return (
    <div className="app-shell">
      <aside
        inert={!!dialog}
        aria-hidden={!!dialog}
        className={mobile ? "sidebar show" : "sidebar"}
      >
        <Link className="wordmark" href="/">
          enactus
          <span>
            zhetysu <i>TEAM HUB</i>
          </span>
        </Link>
        <div className="workspace">
          <div className="workspace-icon">Z</div>
          <div>
            <strong>Enactus Zhetysu</strong>
            <small>{ui.s035}</small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <span className="nav-label">{ui.s036}</span>
        <nav>
          {["today", "meetings", "tasks", "history", "metrics"].map((s) => {
            const Icon = icons[s];
            return (
              <button
                className={section === s ? "nav-item active" : "nav-item"}
                key={s}
                onClick={() => navigate(s)}
              >
                <Icon size={19} />
                {titleFor(s)}
                {s === "tasks" && myTasks.length > 0 && (
                  <span className="count">{myTasks.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        {adminNav.length > 0 && (
          <>
            <span className="nav-label management-label">{ui.s037}</span>
            <nav>
              {adminNav.map(([s]) => {
                const Icon = icons[s];
                return (
                  <button
                    key={s}
                    className={section === s ? "nav-item active" : "nav-item"}
                    onClick={() => navigate(s)}
                  >
                    <Icon size={18} />
                    {titleFor(s)}
                  </button>
                );
              })}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="closed-note">
            <ShieldCheck size={18} />
            <div>
              <strong>{ui.s038}</strong>
              <small>{ui.s039}</small>
            </div>
          </div>
          <button className="user-button" onClick={() => navigate("profile")}>
            <span className="avatar">{user.display_name.slice(0, 1)}</span>
            <span>
              <strong>{user.display_name}</strong>
              <small>{user.owner ? ui.s040 : ui.s041}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          aria-label={ui.s042}
          className="scrim"
          onClick={() => setMobile(false)}
        />
      )}
      <div inert={!!dialog} aria-hidden={!!dialog} className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={ui.s043}
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            {ui.s044}
            <ChevronRight size={13} />
            <b>{titleFor(section)}</b>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <span />
              {ui.s045}
            </span>
            <button
              className="top-avatar"
              aria-label={ui.s046}
              onClick={() => navigate("profile")}
            >
              {user.display_name.slice(0, 1)}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                ENACTUS ZHETYSU <span>/</span>{" "}
                {new Intl.DateTimeFormat("ru-RU", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Asia/Almaty",
                }).format(new Date())}
              </div>
              <h1>
                {section === "today" ? (
                  <>
                    {ui.s047}
                    {user.display_name.split(" ")[0]}{" "}
                    <span className="wave">✳</span>
                  </>
                ) : (
                  titleFor(section)
                )}
              </h1>
              <p>
                {section === "today"
                  ? ui.s048
                  : section === "meetings"
                    ? ui.s049
                    : section === "tasks"
                      ? ui.s050
                      : section === "feedback"
                        ? ui.s051
                        : ui.s052}
              </p>
            </div>
            <div className="heading-action">
              {section === "today" && (
                <span className="today-chip">
                  <CalendarDays size={17} />
                  {new Intl.DateTimeFormat("ru-RU", {
                    weekday: "long",
                    timeZone: "Asia/Almaty",
                  }).format(new Date())}
                </span>
              )}
              {section === "meetings" && can("meetings.create") && (
                <Button onClick={() => open("create-meeting")}>
                  <Plus size={17} />
                  {ui.s053}
                </Button>
              )}
              {section === "tasks" && can("tasks.create") && (
                <Button onClick={() => open("create-task")}>
                  <Plus size={17} />
                  {ui.s054}
                </Button>
              )}
              {section === "users" && (
                <Button onClick={() => open("invite")}>
                  <Plus size={17} />
                  {ui.s055}
                </Button>
              )}
              {section === "departments" && (
                <Button onClick={() => open("create-department")}>
                  <Plus size={17} />
                  {ui.s056}
                </Button>
              )}
              {section === "permissions" && (
                <Button onClick={() => open("grant")}>
                  <Plus size={17} />
                  {ui.s057}
                </Button>
              )}
            </div>
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button aria-label={ui.s058} onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              <Check size={17} />
              {notice}
              <button aria-label={ui.s059} onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {section === "today" && (
            <>
              <div className="dashboard-grid">
                <section className="hero-card">
                  <div className="hero-content">
                    <div className="hero-eyebrow">
                      <span />
                      {ui.s060}
                    </div>
                    <h2>
                      {ui.s061}
                      <br />
                      {ui.s062}
                    </h2>
                    <p>
                      {ui.s063}
                      <br className="desktop" />
                      {ui.s064}
                    </p>
                    <button onClick={() => navigate("tasks")}>
                      {ui.s065}
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div aria-hidden="true" className="hero-art">
                    <div className="art-square one" />
                    <div className="art-square two" />
                    <div className="art-square three" />
                    <ArrowUpRight className="art-arrow" strokeWidth={1.5} />
                    <span>
                      entrepreneurial
                      <br />
                      action for others.
                    </span>
                  </div>
                </section>
                <section className="checkin-card">
                  <div className="section-kicker">
                    <span className="live-dot" />
                    {ui.s066} <QrCode size={18} />
                  </div>
                  <h3>{active ? active.title : ui.s067}</h3>
                  <p>
                    {active ? (
                      <>
                        <Clock size={14} />
                        {time(active.starts_at)} – {time(active.ends_at)}
                        <br />
                        <MapPin size={14} />
                        {active.location_label || ui.s068}
                      </>
                    ) : (
                      ui.s069
                    )}
                  </p>
                  <div className="attendance-status">
                    <span />
                    {active
                      ? active.attendance
                        ? ui.s070 + time(active.attendance.check_in_at)
                        : ui.s071
                      : ui.s072}
                  </div>
                  <Button
                    onClick={() =>
                      active ? open("meeting", active) : navigate("meetings")
                    }
                  >
                    {active ? (active.attendance ? ui.s073 : ui.s074) : ui.s075}
                    <ArrowRight size={17} />
                  </Button>
                  <small>
                    <MapPin size={12} />
                    {ui.s076}
                  </small>
                </section>
              </div>
              <div className="stat-grid">
                {[
                  {
                    name: ui.s077,
                    value: metrics.required
                      ? `${metrics.visited} / ${metrics.required}`
                      : ui.s078,
                    note: ui.s079,
                    icon: CalendarDays,
                  },
                  {
                    name: ui.s080,
                    value: metrics.accepted ?? 0,
                    note: ui.s081,
                    icon: CheckSquare,
                  },
                  {
                    name: ui.s082,
                    value: myTasks.length,
                    note: ui.s083,
                    icon: Target,
                  },
                  {
                    name: ui.s084,
                    value: metrics.accepted
                      ? `${metrics.onTime} / ${metrics.accepted}`
                      : ui.s078,
                    note: ui.s085,
                    icon: ChartNoAxesCombined,
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.name}>
                    <div>
                      <span>{s.name}</span>
                      <s.icon size={18} />
                    </div>
                    <strong>{s.value}</strong>
                    <small>{s.note}</small>
                  </div>
                ))}
              </div>
              <section className="section-block">
                <div className="section-title">
                  <h2>
                    {ui.s086}
                    <span>{upcoming.length}</span>
                  </h2>
                  <button onClick={() => navigate("meetings")}>
                    {ui.s087}
                    <ArrowRight size={15} />
                  </button>
                </div>
                {upcoming.length ? (
                  <div className="meeting-grid">
                    {upcoming.slice(0, 3).map(meetingCard)}
                  </div>
                ) : (
                  <Empty text={ui.s088} />
                )}
              </section>
              <section className="section-block">
                <div className="section-title">
                  <h2>
                    {ui.s089}
                    <span>{myTasks.length}</span>
                  </h2>
                  <button onClick={() => navigate("tasks")}>
                    {ui.s090}
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div className="list-card">
                  {myTasks.length ? (
                    myTasks.slice(0, 5).map(taskRow)
                  ) : (
                    <Empty text={ui.s091} />
                  )}
                </div>
              </section>
              <div className="bottom-note">
                <span className="small-mark">e↗</span>
                <p>{ui.s092}</p>
                <span>{ui.s093}</span>
              </div>
            </>
          )}
          {section === "meetings" && (
            <>
              <div className="info-strip">
                <QrCode size={20} />
                <span>{ui.s094}</span>
              </div>
              {meetings.length ? (
                <div className="meeting-grid">{meetings.map(meetingCard)}</div>
              ) : (
                <Empty text={ui.s095} />
              )}
            </>
          )}
          {section === "tasks" && (
            <>
              <div className="task-summary">
                {["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"].map((s) => (
                  <div key={s}>
                    <Badge value={s} />
                    <strong>
                      {tasks.filter((t) => t.status === s).length}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="list-card">
                {tasks.length ? tasks.map(taskRow) : <Empty text={ui.s096} />}
              </div>
            </>
          )}
          {(section === "history" || section === "reports") && (
            <>
              <form
                className="filter-bar"
                onSubmit={(e) => {
                  const v = values(e);
                  const p = new URLSearchParams();
                  for (const [k, val] of Object.entries(v))
                    if (val)
                      p.set(
                        k,
                        k === "from" || k === "to"
                          ? new Date(
                              val +
                                (k === "to"
                                  ? "T23:59:59+05:00"
                                  : "T00:00:00+05:00"),
                            ).toISOString()
                          : val,
                      );
                  if (section === "history") p.set("user", user.id);
                  setFilters(p.toString());
                  void run(async () => setReport(await api("reports?" + p)));
                }}
              >
                <Field
                  name="from"
                  label={ui.s097}
                  type="date"
                  required={false}
                />
                <Field name="to" label={ui.s098} type="date" required={false} />
                {section === "reports" && (
                  <>
                    <Field name="department" label={ui.s099} required={false}>
                      {deptSelect}
                    </Field>
                    <Field name="user" label={ui.s100} required={false}>
                      <option value="">{ui.s101}</option>
                      {userSelect}
                    </Field>
                    <Field name="meeting" label={ui.s102} required={false}>
                      <option value="">{ui.s101}</option>
                      {meetings.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </Field>
                  </>
                )}
                <Button type="submit" secondary>
                  {ui.s103}
                </Button>
                {can("reports.export") && (
                  <a
                    className="button secondary"
                    href={"/api/reports?format=csv&" + filters}
                  >
                    CSV ↓
                  </a>
                )}
              </form>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{ui.s102}</th>
                      {section === "reports" && <th>{ui.s100}</th>}
                      <th>{ui.s104}</th>
                      <th>{ui.s105}</th>
                      <th>{ui.s106}</th>
                      <th>{ui.s107}</th>
                      <th>{ui.s108}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows
                      .filter(
                        (r: Row) =>
                          section === "reports" || r.user_id === user.id,
                      )
                      .map((r: Row) => (
                        <tr key={r.meeting_id + r.user_id}>
                          <td>{r.title}</td>
                          {section === "reports" && <td>{r.display_name}</td>}
                          <td>{date(r.starts_at)}</td>
                          <td>{time(r.check_in_at)}</td>
                          <td>{time(r.check_out_at)}</td>
                          <td>
                            {r.minutes_between_marks !== null
                              ? r.minutes_between_marks + ui.s109
                              : "—"}
                          </td>
                          <td>
                            <Badge value={r.result} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!report.rows.length && <Empty />}
              </div>
              <p className="footnote">{ui.s110}</p>
              {section === "reports" && report.summary?.length > 0 && (
                <section className="section-block">
                  <h3>{ui.s111}</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{ui.s100}</th>
                          <th>{ui.s112}</th>
                          <th>{ui.s113}</th>
                          <th>{ui.s114}</th>
                          <th>{ui.s115}</th>
                          <th>{ui.s116}</th>
                          <th>{ui.s117}</th>
                          <th>{ui.s118}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.summary.map((r: Row) => (
                          <tr key={r.user_id}>
                            <td>{r.display_name}</td>
                            <td>
                              {r.required
                                ? `${r.visited} / ${r.required}`
                                : ui.s078}
                            </td>
                            <td>{r.absent}</td>
                            <td>{r.late}</td>
                            <td>{r.missingCheckout}</td>
                            <td>{r.accepted}</td>
                            <td>
                              {r.accepted
                                ? `${r.onTime} / ${r.accepted}`
                                : ui.s078}
                            </td>
                            <td>{r.overdue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="footnote">{ui.s119}</p>
                  {can("reports.export") && (
                    <a
                      className="button secondary"
                      href={"/api/reports?format=csv&kind=metrics&" + filters}
                    >
                      {ui.s120}
                    </a>
                  )}
                </section>
              )}
            </>
          )}
          {section === "metrics" && (
            <>
              <div className="stat-grid">
                {[
                  [ui.s121, metrics.required],
                  [ui.s122, metrics.visited],
                  [ui.s113, metrics.absent],
                  [ui.s123, metrics.late],
                  [ui.s124, metrics.missingCheckout],
                  [ui.s080, metrics.accepted],
                  [
                    ui.s084,
                    metrics.accepted
                      ? `${metrics.onTime} / ${metrics.accepted}`
                      : ui.s078,
                  ],
                  [ui.s125, metrics.overdue],
                ].map(([n, v]) => (
                  <div className="stat-card" key={n}>
                    <span>{n}</span>
                    <strong>{v ?? ui.s078}</strong>
                  </div>
                ))}
              </div>
              <div className="info-strip">
                <ShieldCheck />
                <span>{ui.s126}</span>
              </div>
            </>
          )}
          {section === "users" && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{ui.s100}</th>
                      <th>{ui.s127}</th>
                      <th>{ui.s108}</th>
                      <th>{ui.s128}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <span className="inline-avatar">
                            {u.display_name[0]}
                          </span>
                          {u.display_name}
                        </td>
                        <td>{u.login}</td>
                        <td>
                          <Badge value={u.status} />
                        </td>
                        <td>
                          {u.id !== user.id && (
                            <div className="table-actions">
                              <button
                                onClick={() =>
                                  void run(async () =>
                                    mutation(
                                      "users/" + u.id,
                                      "PATCH",
                                      {
                                        status:
                                          u.status === "BLOCKED"
                                            ? "ACTIVE"
                                            : "BLOCKED",
                                      },
                                      false,
                                    ),
                                  )
                                }
                              >
                                {u.status === "BLOCKED" ? ui.s129 : ui.s130}
                              </button>
                              <button
                                onClick={() =>
                                  void run(async () => {
                                    const r = await api(
                                      "users/" + u.id,
                                      "PATCH",
                                      { reinvite: true },
                                    );
                                    setPrivateLink(
                                      window.location.origin +
                                        r.activation_path,
                                    );
                                    setDialog("link");
                                  })
                                }
                              >
                                {ui.s131}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!users.length && <Empty />}
              </div>
            </>
          )}
          {section === "departments" && (
            <div className="meeting-grid">
              {departments.map((d) => (
                <div className="panel department-card" key={d.id}>
                  <div className="icon-box">
                    <Building2 />
                  </div>
                  <h3>{d.name}</h3>
                  <p className="muted">
                    {d.members.length}
                    {ui.s132} {d.status === "ACTIVE" ? ui.s133 : ui.s134}
                  </p>
                  <div className="member-list">
                    {d.members.map((m: Row) => (
                      <div key={m.user_id}>
                        <span>{m.display_name}</span>
                        {can("departments.manage") && (
                          <button
                            aria-label={ui.s135 + m.display_name}
                            onClick={() =>
                              void run(async () =>
                                mutation(
                                  "departments/" + d.id,
                                  "PATCH",
                                  { user_id: m.user_id, remove: true },
                                  false,
                                ),
                              )
                            }
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {can("departments.manage") && (
                    <>
                      <Button
                        secondary
                        onClick={() => open("department-member", d)}
                      >
                        <Plus size={16} />
                        {ui.s136}
                      </Button>
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(async () =>
                            mutation(
                              "departments/" + d.id,
                              "PATCH",
                              {
                                status:
                                  d.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
                              },
                              false,
                            ),
                          )
                        }
                      >
                        {d.status === "ACTIVE" ? ui.s137 : ui.s138}
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!departments.length && <Empty />}
            </div>
          )}
          {section === "permissions" && (
            <>
              <div className="info-strip">
                <KeyRound />
                <span>{ui.s139}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{ui.s100}</th>
                      <th>{ui.s140}</th>
                      <th>{ui.s141}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((g) => (
                      <tr key={g.id}>
                        <td>{g.display_name}</td>
                        <td>
                          <code>{g.permission}</code>
                        </td>
                        <td>
                          {g.scope_type === "TEAM"
                            ? ui.s142
                            : departments.find((d) => d.id === g.scope_id)
                                ?.name ||
                              meetings.find((m) => m.id === g.scope_id)
                                ?.title ||
                              g.scope_id}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              void run(async () => {
                                await api("permissions/" + g.id, "DELETE", {});
                                setRows(await api("permissions"));
                              })
                            }
                          >
                            {ui.s143}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <Empty text={ui.s144} />}
              </div>
            </>
          )}
          {section === "feedback" && (
            <div className="feedback-list">
              {rows.map((f) => (
                <article className="panel" key={f.id}>
                  <div className="section-title">
                    <h3>{f.meeting_title}</h3>
                    <Badge value={f.status} />
                  </div>
                  <p className="muted">
                    {f.mode === "ANONYMOUS" ? ui.s145 : f.author_name} ·{" "}
                    {String(f.coarse_date).slice(0, 10)}{" "}
                    {f.rating && `· ${f.rating} / 5`}
                  </p>
                  <p className="preserve">{f.comment}</p>
                  {f.positive && (
                    <p>
                      <b>{ui.s146}</b>
                      {f.positive}
                    </p>
                  )}
                  {f.improvement && (
                    <p>
                      <b>{ui.s147}</b>
                      {f.improvement}
                    </p>
                  )}
                  {f.notes?.map((n: Row) => (
                    <p className="internal-note" key={n.id}>
                      {ui.s148}
                      {n.note}
                    </p>
                  ))}
                  {f.canManage && (
                    <Button
                      secondary
                      onClick={() => open("process-feedback", f)}
                    >
                      {ui.s149}
                    </Button>
                  )}
                </article>
              ))}
              {!rows.length && <Empty text={ui.s150} />}
            </div>
          )}
          {section === "audit" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{ui.s151}</th>
                    <th>{ui.s152}</th>
                    <th>{ui.s153}</th>
                    <th>{ui.s154}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{full(r.created_at)}</td>
                      <td>{r.display_name}</td>
                      <td>
                        <code>{r.action}</code>
                      </td>
                      <td>
                        {r.object_type}{" "}
                        <span className="muted">
                          {r.object_id?.slice(0, 8)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <Empty />}
            </div>
          )}
          {section === "profile" && (
            <section className="panel profile-card">
              <span className="avatar large">{user.display_name[0]}</span>
              <h2>{user.display_name}</h2>
              <p className="muted">
                @{user.login} · {user.owner ? ui.s155 : ui.s100}
              </p>
              <div className="info-strip">
                <ShieldCheck />
                <span>{ui.s156}</span>
              </div>
              <h3>{ui.s157}</h3>
              {user.owner ? (
                <p>{ui.s158}</p>
              ) : user.grants.length ? (
                user.grants.map((g: Row) => (
                  <p key={g.id}>
                    <code>{g.permission}</code> · {g.scope_type}
                  </p>
                ))
              ) : (
                <p className="muted">{ui.s159}</p>
              )}
              <p className="footnote">{ui.s160}</p>
              <Button
                secondary
                onClick={() =>
                  void run(async () => {
                    await api("auth/logout", "POST", {});
                    setUser(null);
                    setQrToken("");
                  })
                }
              >
                <LogOut size={16} />
                {ru.logout}
              </Button>
            </section>
          )}
        </main>
        <footer>
          <span>© {new Date().getFullYear()} Enactus Zhetysu</span>
          <span>
            <span className="footer-dot" />
            {ui.s161}
          </span>
        </footer>
      </div>
      {dialog && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog("");
          }}
        >
          <section
            className={"modal " + (dialog === "qr" ? "qr-modal" : "")}
            role="dialog"
            aria-modal="true"
            aria-label={ui.s153}
          >
            <button
              className="modal-close icon-button"
              aria-label={ui.s162}
              onClick={() => {
                geoCancelled.current = true;
                setDialog("");
              }}
            >
              <X size={20} />
            </button>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {dialog === "meeting" && selected && (
              <>
                <span className="eyebrow">{ui.s163}</span>
                <h2>{selected.title}</h2>
                <Badge value={selected.status} />
                <p className="preserve">{selected.description}</p>
                <div className="meeting-details">
                  <p>
                    <CalendarDays size={17} />
                    {full(selected.starts_at)} — {time(selected.ends_at)}
                  </p>
                  <p>
                    <MapPin size={17} />
                    {selected.location_label || ui.s068}
                    {ui.s164}
                  </p>
                  <p>
                    <Clock size={17} />
                    {ui.s165}
                    {full(selected.registration_open_at)} —{" "}
                    {time(selected.registration_close_at)}
                  </p>
                  <p>
                    <Clock size={17} />
                    {ui.s166}
                    {full(selected.checkout_close_at)}
                  </p>
                </div>
                <div className="attendance-box">
                  <strong>
                    {selected.attendance
                      ? selected.attendance.check_out_at
                        ? ui.s167
                        : ui.s168
                      : ui.s071}
                  </strong>
                  {selected.attendance && (
                    <p>
                      {ui.s165}
                      {time(selected.attendance.check_in_at)}
                      {ui.s169} {time(selected.attendance.check_out_at)}
                      {selected.attendance.check_out_at && (
                        <>
                          <br />
                          {ui.s170}{" "}
                          {Math.round(
                            (new Date(
                              selected.attendance.check_out_at,
                            ).getTime() -
                              new Date(
                                selected.attendance.check_in_at,
                              ).getTime()) /
                              60000,
                          )}{" "}
                          {ui.s171}
                        </>
                      )}
                    </p>
                  )}
                </div>
                {selected.expected &&
                  selected.status === "OPEN" &&
                  !selected.attendance?.check_out_at && (
                    <>
                      {!selected.attendance && !qrToken && (
                        <div className="info-strip">
                          <QrCode />
                          <span>{ui.s172}</span>
                        </div>
                      )}
                      <Button
                        disabled={busy || (!selected.attendance && !qrToken)}
                        onClick={() => void mark(selected)}
                      >
                        {busy ? (
                          <LoaderCircle size={18} className="spin" />
                        ) : (
                          <MapPin size={18} />
                        )}{" "}
                        {selected.attendance ? ui.s073 : ui.s173}
                      </Button>
                      <small className="footnote">{ui.s174}</small>
                    </>
                  )}
                {geoProgress && (
                  <div className="info-strip">
                    <LoaderCircle className="spin" />
                    <span>{geoProgress}</span>
                    <button
                      onClick={() => {
                        geoCancelled.current = true;
                        setGeoProgress(ui.s175);
                      }}
                    >
                      {ui.s176}
                    </button>
                  </div>
                )}
                {selected.canQR && selected.status === "OPEN" && (
                  <Button secondary onClick={() => setDialog("qr")}>
                    <QrCode size={18} />
                    {ui.s177}
                  </Button>
                )}
                {selected.expected && selected.status === "CLOSED" && (
                  <Button
                    secondary
                    onClick={() => {
                      feedbackKey.current = crypto.randomUUID();
                      setDialog("send-feedback");
                    }}
                  >
                    <MessageSquare size={18} />
                    {ui.s178}
                  </Button>
                )}
                {selected.canManage &&
                  !["CLOSED", "CANCELLED"].includes(selected.status) && (
                    <div className="admin-meeting">
                      <span className="eyebrow">{ui.s037}</span>
                      <div className="table-actions">
                        {(selected.status === "DRAFT"
                          ? ["SCHEDULED", "CANCELLED"]
                          : selected.status === "SCHEDULED"
                            ? ["OPEN", "CANCELLED"]
                            : ["CLOSED", "CANCELLED"]
                        ).map((s) => (
                          <Button
                            key={s}
                            secondary
                            onClick={() => {
                              if (
                                window.confirm(
                                  s === "CANCELLED"
                                    ? ui.s179
                                    : ui.s180 + label(s) + "»?",
                                )
                              )
                                void run(async () =>
                                  mutation("meetings/" + selected.id, "PATCH", {
                                    status: s,
                                  }),
                                );
                            }}
                          >
                            {s === "OPEN"
                              ? ui.s181
                              : s === "CLOSED"
                                ? ui.s182
                                : label(s)}
                          </Button>
                        ))}
                      </div>
                      {selected.status !== "OPEN" && (
                        <Button
                          secondary
                          onClick={() => setDialog("edit-meeting")}
                        >
                          {ui.s183}
                        </Button>
                      )}
                    </div>
                  )}
              </>
            )}
            {dialog === "qr" && selected && <QRScreen meeting={selected} />}
            {dialog === "edit-meeting" && selected && (
              <>
                <h2>{ui.s184}</h2>
                <p className="muted">{ui.s185}</p>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () =>
                      mutation("meetings/" + selected.id, "PATCH", {
                        title: p.title,
                        latitude: Number(p.latitude),
                        longitude: Number(p.longitude),
                      }),
                    );
                  }}
                >
                  <Field
                    name="title"
                    label={ui.s186}
                    defaultValue={selected.title}
                  />
                  <div className="form-row">
                    <Field
                      name="latitude"
                      label={ui.s187}
                      type="number"
                      step="any"
                      defaultValue={selected.latitude}
                    />
                    <Field
                      name="longitude"
                      label={ui.s188}
                      type="number"
                      step="any"
                      defaultValue={selected.longitude}
                    />
                  </div>
                  <Button type="submit" disabled={busy}>
                    {ui.s189}
                  </Button>
                </form>
              </>
            )}
            {dialog === "create-meeting" && (
              <>
                <span className="eyebrow">{ui.s190}</span>
                <h2>{ui.s191}</h2>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    const toISO = (s: string) =>
                      new Date(s + ":00+05:00").toISOString();
                    void run(async () =>
                      mutation("meetings", "POST", {
                        title: p.title,
                        description: p.description,
                        location_label: p.location_label,
                        department_id: p.department_id || null,
                        latitude: Number(p.latitude),
                        longitude: Number(p.longitude),
                        starts_at: toISO(p.starts_at),
                        ends_at: toISO(p.ends_at),
                        registration_open_at: toISO(p.registration_open_at),
                        registration_close_at: toISO(p.registration_close_at),
                        checkout_close_at: toISO(p.checkout_close_at),
                        status: "DRAFT",
                        late_after_minutes: p.late_after_minutes
                          ? Number(p.late_after_minutes)
                          : null,
                        attendees: users
                          .filter((u) => p["attendee_" + u.id])
                          .map((u) => ({
                            user_id: u.id,
                            required: p["required_" + u.id] === "on",
                          })),
                      }),
                    );
                  }}
                >
                  <Field name="title" label={ui.s186} maxLength={160} />
                  <Field
                    name="description"
                    label={ui.s192}
                    type="textarea"
                    required={false}
                  />
                  <Field name="department_id" label={ui.s099} required={false}>
                    {deptSelect}
                  </Field>
                  <Field name="location_label" label={ui.s193} />
                  <div className="form-row">
                    <Field
                      name="latitude"
                      label={ui.s194}
                      type="number"
                      min={-90}
                      max={90}
                      step="any"
                    />
                    <Field
                      name="longitude"
                      label={ui.s195}
                      type="number"
                      min={-180}
                      max={180}
                      step="any"
                    />
                  </div>
                  <p className="footnote">{ui.s196}</p>
                  <div className="form-row">
                    <Field
                      name="starts_at"
                      label={ui.s197}
                      type="datetime-local"
                    />
                    <Field
                      name="ends_at"
                      label={ui.s198}
                      type="datetime-local"
                    />
                  </div>
                  <div className="form-row">
                    <Field
                      name="registration_open_at"
                      label={ui.s199}
                      type="datetime-local"
                    />
                    <Field
                      name="registration_close_at"
                      label={ui.s200}
                      type="datetime-local"
                    />
                  </div>
                  <Field
                    name="checkout_close_at"
                    label={ui.s201}
                    type="datetime-local"
                  />
                  <Field
                    name="late_after_minutes"
                    label={ui.s202}
                    type="number"
                    min={0}
                    required={false}
                  />
                  <fieldset>
                    <legend>{ui.s203}</legend>
                    {users
                      .filter((u) => u.status === "ACTIVE")
                      .map((u) => (
                        <div className="attendee-choice" key={u.id}>
                          <label>
                            <input type="checkbox" name={"attendee_" + u.id} />
                            {u.display_name}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              name={"required_" + u.id}
                              defaultChecked
                            />
                            {ui.s204}
                          </label>
                        </div>
                      ))}
                    <small>{ui.s205}</small>
                  </fieldset>
                  <Button type="submit" disabled={busy}>
                    {ui.s206}
                    <ArrowRight size={17} />
                  </Button>
                </form>
              </>
            )}
            {dialog === "create-task" && (
              <>
                <span className="eyebrow">{ui.s207}</span>
                <h2>{ui.s208}</h2>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () =>
                      mutation("tasks", "POST", {
                        title: p.title,
                        description: p.description,
                        department_id: p.department_id || null,
                        assigned_to: p.assigned_to,
                        due_at: new Date(p.due_at + ":00+05:00").toISOString(),
                        priority: p.priority,
                        expected_result: p.expected_result,
                        collaborators: users
                          .filter((u) => p["collab_" + u.id])
                          .map((u) => u.id),
                      }),
                    );
                  }}
                >
                  <Field name="title" label={ui.s186} />
                  <Field
                    name="description"
                    label={ui.s192}
                    type="textarea"
                    required={false}
                  />
                  <Field name="department_id" label={ui.s099} required={false}>
                    {deptSelect}
                  </Field>
                  <Field name="assigned_to" label={ui.s209}>
                    {userSelect}
                  </Field>
                  <Field name="due_at" label={ui.s210} type="datetime-local" />
                  <Field name="priority" label={ui.s211} defaultValue="NORMAL">
                    <option value="LOW">{ui.s033}</option>
                    <option value="NORMAL">{ui.s034}</option>
                    <option value="HIGH">{ui.s032}</option>
                  </Field>
                  <Field
                    name="expected_result"
                    label={ui.s212}
                    type="textarea"
                    required={false}
                  />
                  <fieldset>
                    <legend>{ui.s213}</legend>
                    {users.map((u) => (
                      <label className="check-label" key={u.id}>
                        <input name={"collab_" + u.id} type="checkbox" />
                        {u.display_name}
                      </label>
                    ))}
                  </fieldset>
                  <Button type="submit" disabled={busy}>
                    {ui.s054}
                  </Button>
                </form>
              </>
            )}
            {dialog === "task" && selected && (
              <>
                <span className="eyebrow">{ui.s214}</span>
                <h2>{selected.title}</h2>
                <Badge value={selected.status} />
                <p className="preserve">{selected.description}</p>
                <p className="muted">
                  {ui.s215}
                  {selected.assignee_name}
                  <br />
                  {ui.s216}
                  {full(selected.due_at)}
                </p>
                {selected.expected_result && (
                  <div className="info-strip">
                    <Target />
                    <span>{selected.expected_result}</span>
                  </div>
                )}
                {selected.canWork &&
                  ["TODO", "IN_PROGRESS"].includes(selected.status) && (
                    <form
                      onSubmit={(e) => {
                        const p = values(e);
                        void run(async () =>
                          mutation("tasks/" + selected.id + "/submit", "POST", {
                            comment: p.comment,
                            ...(p.result_url
                              ? { result_url: p.result_url }
                              : {}),
                          }),
                        );
                      }}
                    >
                      <Field
                        name="comment"
                        label={ui.s217}
                        type="textarea"
                        required={false}
                      />
                      <Field
                        name="result_url"
                        label={ui.s218}
                        type="url"
                        required={false}
                      />
                      <Button type="submit" disabled={busy}>
                        {ui.s219}
                      </Button>
                      {selected.status === "TODO" && (
                        <Button
                          secondary
                          onClick={() =>
                            void run(async () =>
                              mutation(
                                "tasks/" + selected.id + "/start",
                                "POST",
                                {},
                              ),
                            )
                          }
                        >
                          {ui.s220}
                        </Button>
                      )}
                    </form>
                  )}
                {selected.canReview && selected.status === "IN_REVIEW" && (
                  <form
                    onSubmit={(e) => {
                      const p = values(e);
                      void run(async () =>
                        mutation("tasks/" + selected.id + "/review", "POST", {
                          comment: p.comment,
                          accept: p.decision === "accept",
                        }),
                      );
                    }}
                  >
                    <Field name="decision" label={ui.s221}>
                      <option value="accept">{ui.s222}</option>
                      <option value="return">{ui.s223}</option>
                    </Field>
                    <Field
                      name="comment"
                      label={ui.s224}
                      type="textarea"
                      required={false}
                    />
                    <Button type="submit" disabled={busy}>
                      {ui.s225}
                    </Button>
                  </form>
                )}
                {selected.canManage && selected.status !== "DONE" && (
                  <Button secondary onClick={() => setDialog("edit-task")}>
                    {ui.s226}
                  </Button>
                )}
                <h3>{ui.s227}</h3>
                {detail?.comments?.map((c: Row) => (
                  <div className="comment" key={c.id}>
                    <strong>{c.display_name}</strong>
                    <small>{full(c.created_at)}</small>
                    <p className="preserve">{c.comment}</p>
                    {c.result_url && (
                      <a
                        href={c.result_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {ui.s228}
                      </a>
                    )}
                  </div>
                ))}
                {selected.canWork && (
                  <form
                    onSubmit={(e) => {
                      const p = values(e);
                      void run(async () => {
                        await api(
                          "tasks/" + selected.id + "/comment",
                          "POST",
                          p,
                        );
                        setDetail(await api("tasks/" + selected.id));
                      });
                    }}
                  >
                    <Field name="comment" label={ui.s229} type="textarea" />
                    <Button secondary type="submit" disabled={busy}>
                      {ui.s230}
                    </Button>
                  </form>
                )}
                <h3>{ui.s231}</h3>
                {detail?.events?.map((v: Row) => (
                  <div key={v.id} className="event">
                    <small>{full(v.created_at)}</small>
                    <strong>{v.event}</strong>
                    <pre>{JSON.stringify(v.after_data, null, 2)}</pre>
                  </div>
                ))}
              </>
            )}
            {dialog === "edit-task" && selected && (
              <>
                <h2>{ui.s232}</h2>
                <p className="muted">{ui.s233}</p>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () =>
                      mutation("tasks/" + selected.id, "PATCH", {
                        assigned_to: p.assigned_to,
                        due_at: new Date(p.due_at + ":00+05:00").toISOString(),
                      }),
                    );
                  }}
                >
                  <Field
                    name="assigned_to"
                    label={ui.s209}
                    defaultValue={selected.assigned_to}
                  >
                    {userSelect}
                  </Field>
                  <Field name="due_at" label={ui.s234} type="datetime-local" />
                  <Button type="submit" disabled={busy}>
                    {ui.s189}
                  </Button>
                </form>
              </>
            )}
            {dialog === "invite" && (
              <>
                <h2>{ui.s235}</h2>
                <p className="muted">{ui.s236}</p>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () => {
                      const r = await api("users", "POST", {
                        ...p,
                        department_id: p.department_id || null,
                      });
                      setPrivateLink(
                        window.location.origin + r.activation_path,
                      );
                      await load();
                      setDialog("link");
                    });
                  }}
                >
                  <Field name="display_name" label={ui.s237} />
                  <Field
                    name="login"
                    label={ui.s238}
                    pattern="[a-z0-9_.\-]{3,50}"
                  />
                  <Field name="department_id" label={ui.s099} required={false}>
                    {deptSelect}
                  </Field>
                  <Button type="submit" disabled={busy}>
                    {ui.s239}
                  </Button>
                </form>
              </>
            )}
            {dialog === "link" && (
              <>
                <div className="icon-box">
                  <KeyRound />
                </div>
                <h2>{ui.s240}</h2>
                <p className="muted">{ui.s241}</p>
                <textarea readOnly value={privateLink} aria-label={ui.s242} />
                <Button
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(privateLink);
                      setNotice(ui.s243);
                      setPrivateLink("");
                      setDialog("");
                    })
                  }
                >
                  {ui.s244}
                </Button>
              </>
            )}
            {dialog === "create-department" && (
              <>
                <h2>{ui.s245}</h2>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () => mutation("departments", "POST", p));
                  }}
                >
                  <Field name="name" label={ui.s246} />
                  <Button type="submit" disabled={busy}>
                    {ui.s247}
                  </Button>
                </form>
              </>
            )}
            {dialog === "department-member" && selected && (
              <>
                <h2>{ui.s248}</h2>
                <p>{selected.name}</p>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () =>
                      mutation("departments/" + selected.id, "PATCH", p),
                    );
                  }}
                >
                  <Field name="user_id" label={ui.s100}>
                    {userSelect}
                  </Field>
                  <Button type="submit" disabled={busy}>
                    {ui.s249}
                  </Button>
                </form>
              </>
            )}
            {dialog === "grant" && (
              <>
                <h2>{ui.s250}</h2>
                <p className="muted">{ui.s251}</p>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () => {
                      await api("permissions", "POST", {
                        ...p,
                        scope_id: p.scope_type === "TEAM" ? null : p.scope_id,
                      });
                      setRows(await api("permissions"));
                      setDialog("");
                    });
                  }}
                >
                  <Field name="grantee_id" label={ui.s100}>
                    {userSelect}
                  </Field>
                  <Field name="permission" label={ui.s140}>
                    {user.permissions.map((p: string) => (
                      <option value={p} key={p}>
                        {p}
                      </option>
                    ))}
                  </Field>
                  <Field name="scope_type" label={ui.s252}>
                    <option value="TEAM">{ui.s142}</option>
                    <option value="DEPARTMENT">{ui.s099}</option>
                    <option value="MEETING">{ui.s102}</option>
                  </Field>
                  <Field name="scope_id" label={ui.s253} required={false}>
                    <option value="">{ui.s142}</option>
                    <optgroup label={ui.s254}>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={ui.s255}>
                      {meetings.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </optgroup>
                  </Field>
                  <Button type="submit" disabled={busy}>
                    {ui.s057}
                  </Button>
                </form>
              </>
            )}
            {dialog === "send-feedback" && selected && (
              <>
                <span className="eyebrow">{ui.s256}</span>
                <h2>{ui.s257}</h2>
                <p className="muted">{selected.title}</p>
                <FeedbackForm
                  busy={busy}
                  onSubmit={(p) =>
                    void run(async () => {
                      await api(
                        "meetings/" + selected.id + "/feedback",
                        "POST",
                        { ...p, idempotency_key: feedbackKey.current },
                      );
                      setDialog("");
                      setNotice(ui.s258);
                    })
                  }
                />
              </>
            )}
            {dialog === "process-feedback" && selected && (
              <>
                <h2>{ui.s259}</h2>
                <p className="preserve">{selected.comment}</p>
                <form
                  onSubmit={(e) => {
                    const p = values(e);
                    void run(async () => {
                      await api(
                        "feedback/" + selected.id + "/status",
                        "PATCH",
                        p,
                      );
                      setRows(await api("feedback"));
                      setDialog("");
                    });
                  }}
                >
                  <Field
                    name="status"
                    label={ui.s108}
                    defaultValue={selected.status}
                  >
                    <option value="NEW">{ui.s260}</option>
                    <option value="VIEWED">{ui.s261}</option>
                    <option value="PROCESSED">{ui.s262}</option>
                  </Field>
                  <Field
                    name="note"
                    label={ui.s263}
                    type="textarea"
                    required={false}
                  />
                  <Button type="submit" disabled={busy}>
                    {ui.s189}
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function FeedbackForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (p: Row) => void;
}) {
  const [mode, setMode] = useState("ANONYMOUS");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const p = Object.fromEntries(new FormData(e.currentTarget).entries());
        onSubmit({ ...p, mode, rating: p.rating ? Number(p.rating) : null });
      }}
    >
      <div className="segmented">
        <button
          type="button"
          className={mode === "ANONYMOUS" ? "selected" : ""}
          onClick={() => setMode("ANONYMOUS")}
        >
          {ui.s264}
        </button>
        <button
          type="button"
          className={mode === "NAMED" ? "selected" : ""}
          onClick={() => setMode("NAMED")}
        >
          {ui.s265}
        </button>
      </div>
      <p className="footnote">{mode === "ANONYMOUS" ? ui.s266 : ui.s267}</p>
      <Field name="rating" label={ui.s268} required={false}>
        <option value="">{ui.s269}</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n} / 5
          </option>
        ))}
      </Field>
      <Field name="comment" label={ui.s270} type="textarea" />
      <Field name="positive" label={ui.s271} type="textarea" required={false} />
      <Field
        name="improvement"
        label={ui.s272}
        type="textarea"
        required={false}
      />
      <Button type="submit" disabled={busy}>
        {ui.s273}
      </Button>
    </form>
  );
}
function QRScreen({ meeting }: { meeting: Row }) {
  const [data, setData] = useState<Row | null>(null),
    [image, setImage] = useState(""),
    [now, setNow] = useState(0),
    [connected, setConnected] = useState(true),
    [error, setError] = useState("");
  const clock = useRef({ server: 0, mono: 0 });
  useEffect(() => {
    let alive = true;
    let expiry = 0;
    let lastSuccess = 0;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const started = performance.now();
      try {
        const q = await api("meetings/" + meeting.id + "/qr");
        const url = new URL("/", window.location.origin);
        url.hash = new URLSearchParams({
          meeting: meeting.id,
          token: q.token,
        }).toString();
        const img = await QRCode.toDataURL(url.toString(), {
          width: 560,
          margin: 4,
          errorCorrectionLevel: "M",
        });
        if (alive) {
          clock.current = { server: q.serverTime, mono: started };
          lastSuccess = performance.now();
          expiry = q.expiresAt;
          setNow(q.serverTime);
          setData(q);
          setImage(img);
          setConnected(true);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setConnected(false);
          setError(
            ru.errors[(e as Error).message as keyof typeof ru.errors] ??
              ru.error,
          );
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const tick = setInterval(() => {
      const serverNow =
        clock.current.server + (performance.now() - clock.current.mono);
      setNow(serverNow);
      if (serverNow >= expiry || performance.now() - lastSuccess >= 15000)
        void refresh();
    }, 1000);
    const focus = () => {
      expiry = 0;
      setData(null);
      void refresh();
    };
    window.addEventListener("focus", focus);
    const visibility = () => {
      if (!document.hidden) focus();
    };
    document.addEventListener("visibilitychange", visibility);
    const offline = () => {
      setConnected(false);
      setData(null);
    };
    window.addEventListener("offline", offline);
    return () => {
      alive = false;
      clearInterval(tick);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
    };
  }, [meeting.id]);
  const seconds = data
    ? Math.max(0, Math.ceil((data.expiresAt - now) / 1000))
    : 0;
  const valid = data && seconds > 0 && connected;
  return (
    <>
      <span className="eyebrow">{ui.s274}</span>
      <h2>{meeting.title}</h2>
      <p className="muted">{ui.s275}</p>
      <div className="qr-image">
        {valid ? (
          <img src={image} alt={ui.s276} width={320} height={320} />
        ) : (
          <div>
            <QrCode size={70} />
            <h3>{ui.s277}</h3>
            <p>{error || ui.s278}</p>
          </div>
        )}
      </div>
      <div className="qr-timer">
        <RefreshCw size={16} />
        {valid
          ? ui.qrCountdown(
              Math.floor(seconds / 60)
                .toString()
                .padStart(2, "0"),
              (seconds % 60).toString().padStart(2, "0"),
            )
          : ui.s279}
      </div>
      <p className="footnote">
        <span className={connected ? "live-dot" : "offline-dot"} />{" "}
        {connected ? ui.s280 : ui.s281}
        {ui.s282}
      </p>
      <p className="footnote">{ui.s283}</p>
    </>
  );
}
