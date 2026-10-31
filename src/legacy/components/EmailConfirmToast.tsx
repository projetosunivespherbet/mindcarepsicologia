import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

interface EmailConfirmToastProps {
  email: string;
  onClose?: () => void;
  duration?: number;
}

export const EmailConfirmToast = ({ email, onClose, duration = 3000 }: EmailConfirmToastProps) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setLeaving(true), duration);
    const removeTimer = setTimeout(() => onClose?.(), duration + 400);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [duration, onClose]);

  return (
    <div
      role="status"
      className={`fixed bottom-6 left-6 z-[100] max-w-sm rounded-lg border border-border bg-card shadow-elevated p-4 flex items-start gap-3 ${
        leaving ? "animate-slide-out-left" : "animate-slide-in-left"
      }`}
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-lg gradient-primary shrink-0">
        <Mail className="w-5 h-5 text-primary-foreground" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">Confirme seu e-mail</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Enviamos um link de confirmação para <span className="font-medium text-foreground">{email}</span>.
        </p>
      </div>
    </div>
  );
};
