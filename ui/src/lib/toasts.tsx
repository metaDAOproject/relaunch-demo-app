import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { explainError } from "./errors";

export type Toast = {
  id: number;
  kind: "ok" | "err" | "info";
  title: string;
  detail?: string;
};

type ToastContextValue = {
  toasts: Toast[];
  push: (kind: Toast["kind"], title: string, detail?: string) => void;
  pushError: (error: unknown) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToasts outside ToastProvider");
  return value;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: Toast["kind"], title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, kind, title, detail }]);
      setTimeout(() => dismiss(id), kind === "err" ? 9_000 : 5_000);
    },
    [dismiss],
  );

  const pushError = useCallback(
    (error: unknown) => {
      console.error(error);
      const { title, detail } = explainError(error);
      push("err", title, detail);
    },
    [push],
  );

  return (
    <ToastContext.Provider value={{ toasts, push, pushError, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.kind}`}
          onClick={() => dismiss(toast.id)}
        >
          <b>{toast.title}</b>
          {toast.detail && <span>{toast.detail}</span>}
        </div>
      ))}
    </div>
  );
}
