interface ActionIconButtonProps {
  label: string;
  icon?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export const ActionIconButton = ({ label, icon = ">", onClick, disabled = false }: ActionIconButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="ui-btn ui-btn-neutral min-h-10 gap-2 px-3 py-1.5 text-xs"
  >
    <span aria-hidden>{icon}</span>
    <span>{label}</span>
  </button>
);
