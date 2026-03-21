import { initBotId } from "botid/client/core";

if (process.env.NEXT_PUBLIC_BOTID_ENABLED === "true") {
  initBotId({
    protect: [
      {
        path: "/api/chat",
        method: "POST",
      },
    ],
  });
}
