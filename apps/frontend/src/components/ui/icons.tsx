type IconProps = {
  class?: string;
};

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={`block ${props.class ?? ""}`.trim()}
    >
      <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9c-4.5-.5-8-4-8-9V7l8-4z" />
      <path d="M9 12l2 2l4-4" />
    </svg>
  );
}

export function WorkflowIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={`block ${props.class ?? ""}`.trim()}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
