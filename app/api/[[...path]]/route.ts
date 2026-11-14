import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleApi } from "../../../backend/service.mjs";
export const dynamic = "force-dynamic";
async function route(request: Request) {
  const user = await getChatGPTUser();
  const bindings = env as Cloudflare.Env & {
    AID_WEBHOOK_URL?: string;
    AID_WEBHOOK_TOKEN?: string;
  };
  return handleApi(request, {
    db: bindings.DB,
    userId: user?.userId ?? null,
    agency: {
      url: bindings.AID_WEBHOOK_URL,
      token: bindings.AID_WEBHOOK_TOKEN,
    },
  });
}
export const GET = route;
export const POST = route;
