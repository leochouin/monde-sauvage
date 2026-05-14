import { createClient, SupabaseClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type UnitRow = {
  id: string;
  display_name: string;
  unit_code: string;
  establishment_id: string;
  google_calendar_id: string | null;
};

type CreateUnitBody = {
  establishment_id: string;
  equipment_kind_id: string;
  unit_code: string;
  display_name: string;
  chalet_id?: string | null;
  calendar_name?: string;
  sort_order?: number;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Missing Supabase env configuration" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const raw = await req.json().catch(() => ({} as Record<string, unknown>));

    /** Supporte quelques alias pour robustesse avec proxies / anciens corps. */
    const inventoryUnitId = String(raw.inventory_unit_id ?? (raw as { inventoryUnitId?: string }).inventoryUnitId ?? "").trim();

    const authHeader = req.headers.get("Authorization");
    const accessToken = authHeader?.replace("Bearer ", "") || "";

    if (!accessToken) {
      return json({ error: "Missing Authorization token" }, 401);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const callerId = authData?.user?.id;
    if (authError || !callerId) {
      return json({ error: "Invalid auth token" }, 401);
    }

    const body = raw as CreateUnitBody & Record<string, unknown>;
    const establishmentId = String(body.establishment_id ?? "").trim();
    const equipmentKindId = String(body.equipment_kind_id ?? "").trim();
    const unitCode = String(body.unit_code ?? "").trim().toUpperCase();
    const displayName = String(body.display_name ?? "").trim();
    const wantsCreateBundle = !!(establishmentId && equipmentKindId && unitCode && displayName);

    /** Création unité + agenda (prioritaire : évite l’erreur « Missing inventory_unit_id » si le corps est correct). */
    if (wantsCreateBundle) {
    const chaletIdRaw = body.chalet_id;
    const chaletId =
      chaletIdRaw === undefined || chaletIdRaw === null || String(chaletIdRaw).trim() === ""
        ? null
        : String(chaletIdRaw).trim();

    const { data: kind, error: kindError } = await supabase
      .from("equipment_kind")
      .select("id, establishment_id, is_active")
      .eq("id", equipmentKindId)
      .maybeSingle<{ id: string; establishment_id: string; is_active: boolean }>();

    if (kindError || !kind?.id || !kind.is_active) {
      return json({ error: "Equipment kind not found or inactive" }, 404);
    }
    if (kind.establishment_id !== establishmentId) {
      return json({ error: "Equipment kind does not belong to this establishment" }, 400);
    }

    const { data: establishment, error: estError } = await supabase
      .from("Etablissement")
      .select("key, owner_id, google_calendar_id")
      .eq("key", establishmentId)
      .single();

    if (estError || !establishment) {
      return json({ error: "Establishment not found" }, 404);
    }
    if (establishment.owner_id !== callerId) {
      return json({ error: "Forbidden: establishment owner required" }, 403);
    }
    if (!establishment.google_calendar_id) {
      return json(
        {
          error: "No Google Calendar access. Please connect establishment first.",
          requiresAuth: true,
        },
        401,
      );
    }

    const googleAccessToken = await fetchGoogleAccessToken(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      establishmentId,
    );
    if (!googleAccessToken) {
      return json({ error: "Failed to refresh Google access token", requiresAuth: true }, 401);
    }

    const requestedCalName = String(body.calendar_name || "").trim();
    const summary = requestedCalName || displayName;
    const { calendarId, err: createErr, status } = await createSecondaryCalendar(
      googleAccessToken,
      summary,
      `${summary} (${unitCode})`,
    );
    if (createErr || !calendarId) {
      return json({ error: createErr || "Failed to create Google Calendar" }, status || 502);
    }

    const sortOrder = typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
      ? Math.trunc(body.sort_order)
      : 0;

    const insertRow = {
      establishment_id: establishmentId,
      equipment_kind_id: equipmentKindId,
      chalet_id: chaletId,
      unit_code: unitCode,
      display_name: displayName,
      google_calendar_id: calendarId,
      sort_order: sortOrder,
      is_active: true,
    };

    const { data: row, error: insError } = await supabase.from("inventory_unit").insert(insertRow).select().single();

    if (insError || !row) {
      await deleteGoogleCalendar(googleAccessToken, calendarId);
      return json(
        {
          error: insError?.message || "Failed to save inventory unit",
          details: insError?.details,
        },
        400,
      );
    }

      return json({
      calendar_id: calendarId,
      inventory_unit: row,
      message: "Inventory unit and Google Calendar created",
      });
    }

    if (inventoryUnitId) {
      return await attachCalendarToExistingUnit(supabase, {
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        callerId,
        inventoryUnitId,
        requestedName: String(body.calendar_name || "").trim(),
      });
    }

    return json(
      {
        error:
          "Requête incomplète : pour créer une unité envoyez establishment_id, equipment_kind_id, unit_code et display_name. Pour rattacher un agenda à une ligne existante, envoyez inventory_unit_id.",
      },
      400,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "Internal server error", message }, 500);
  }
});

async function attachCalendarToExistingUnit(
  supabase: SupabaseClient,
  ctx: {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    callerId: string;
    inventoryUnitId: string;
    requestedName: string;
  },
): Promise<Response> {
  const { data: unit, error: unitError } = await supabase
    .from("inventory_unit")
    .select("id, display_name, unit_code, establishment_id, google_calendar_id")
    .eq("id", ctx.inventoryUnitId)
    .single<UnitRow>();

  if (unitError || !unit) {
    return json({ error: "Inventory unit not found" }, 404);
  }

  if (unit.google_calendar_id) {
    return json({
      calendar_id: unit.google_calendar_id,
      message: "Calendar already exists",
    });
  }

  const { data: establishment, error: estError } = await supabase
    .from("Etablissement")
    .select("key, owner_id, google_calendar_id")
    .eq("key", unit.establishment_id)
    .single();

  if (estError || !establishment?.google_calendar_id) {
    return json(
      {
        error: "No Google Calendar access. Please connect establishment first.",
        requiresAuth: true,
      },
      401,
    );
  }
  if (establishment.owner_id !== ctx.callerId) {
    return json({ error: "Forbidden: establishment owner required" }, 403);
  }

  const googleAccessToken = await fetchGoogleAccessToken(
    ctx.SUPABASE_URL,
    ctx.SUPABASE_SERVICE_ROLE_KEY,
    unit.establishment_id,
  );
  if (!googleAccessToken) {
    return json({ error: "Failed to refresh Google access token", requiresAuth: true }, 401);
  }

  const summary = ctx.requestedName || unit.display_name || unit.unit_code || "Unité inventaire";
  const { calendarId, err: createErr, status } = await createSecondaryCalendar(
    googleAccessToken,
    summary,
    `Agenda d'inventaire pour ${summary} (${unit.unit_code})`,
  );
  if (createErr || !calendarId) {
    return json({ error: createErr || "Failed to create Google Calendar" }, status || 500);
  }

  const { error: saveError } = await supabase
    .from("inventory_unit")
    .update({ google_calendar_id: calendarId })
    .eq("id", unit.id);

  if (saveError) {
    await deleteGoogleCalendar(googleAccessToken, calendarId);
    return json(
      {
        error: saveError.message,
        hint: "Calendar was removed after DB failure.",
      },
      500,
    );
  }

  return json({
    calendar_id: calendarId,
    inventory_unit_id: unit.id,
    message: "Inventory calendar created successfully",
  });
}

async function fetchGoogleAccessToken(
  supabaseUrl: string,
  serviceRoleKey: string,
  establishmentId: string,
): Promise<string | null> {
  const refreshTokenRes = await fetch(
    `${supabaseUrl}/functions/v1/refresh-google-token?establishmentId=${encodeURIComponent(establishmentId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const tokenPayload = await refreshTokenRes.json().catch(() => ({}));
  const googleAccessToken = tokenPayload?.access_token;
  if (!refreshTokenRes.ok || typeof googleAccessToken !== "string" || !googleAccessToken) {
    return null;
  }
  return googleAccessToken;
}

async function createSecondaryCalendar(
  accessToken: string,
  summary: string,
  description: string,
): Promise<{ calendarId: string | null; err?: string; status?: number }> {
  const createCalendarRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary,
      description,
      timeZone: "America/Toronto",
    }),
  });
  const createPayload = await createCalendarRes.json().catch(() => ({}));
  if (!createCalendarRes.ok || !createPayload?.id) {
    return {
      calendarId: null,
      err: createPayload?.error?.message || "Failed to create Google Calendar",
      status: createCalendarRes.status || 500,
    };
  }
  return { calendarId: String(createPayload.id) };
}

async function deleteGoogleCalendar(accessToken: string, calendarId: string): Promise<void> {
  try {
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    /* best effort */
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
