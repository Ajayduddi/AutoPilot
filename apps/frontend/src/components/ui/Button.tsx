import { JSX, mergeProps, splitProps } from "solid-js";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(mergeProps({ variant: "primary", size: "md" }, props), [
    "variant",
    "size",
    "class",
    "children"
  ]);

  const baseStyles = "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-900";
  
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 border border-transparent",
    secondary: "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 focus:ring-neutral-500 border border-neutral-700",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 border border-transparent",
    ghost: "bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-white focus:ring-neutral-500",
  };
  
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button
      class={`${baseStyles} ${variants[local.variant as keyof typeof variants]} ${sizes[local.size as keyof typeof sizes]} ${local.class || ""}`}
      {...others}
    >
      {local.children}
    </button>
  );
}
