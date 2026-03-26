import { useParams, useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";
import ChatPage from "./index";

export default function ThreadDetail() {
  const params = useParams();
  const navigate = useNavigate();

  // If no thread id, redirect to home
  createEffect(() => {
    if (!params.id) navigate("/", { replace: true });
  });

  // Render ChatPage, passing threadId as prop (ChatPage will pick up from URL)
  return <ChatPage threadId={params.id} />;
}
