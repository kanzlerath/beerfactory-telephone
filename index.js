const express = require('express');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PORT = Number(process.env.PORT || 3000);
const RESTOPLACE_URL =
  process.env.RESTOPLACE_URL ||
  'https://telephony.restoplace.cc/api/incoming/';

function normalizePhone(value) {
  let phone = String(value || '').replace(/\D/g, '');

  // Novosibirsk landline: 1234567 -> 73831234567
  if (phone.length === 7) {
    phone = '7383' + phone;
  }
  // 3831234567 -> 73831234567
  else if (phone.length === 10 && phone.startsWith('383')) {
    phone = '7' + phone;
  }
  // 8XXXXXXXXXX -> 7XXXXXXXXXX
  else if (phone.length === 11 && phone.startsWith('8')) {
    phone = '7' + phone.slice(1);
  }

  return phone;
}

function okIgnored(res, reason) {
  return res.status(200).json({
    ok: true,
    ignored: true,
    ...(reason ? { reason } : {})
  });
}

async function sendToRestoplace(body, status) {
  if (!body.callid) {
    throw new Error('Missing callid');
  }

  if (!body.phone) {
    throw new Error('Missing phone');
  }

  // In this RestoPlace account extension_id is required in practice.
  if (!body.ext) {
    throw new Error('Missing ext');
  }

  const payload = {
    secret: process.env.RESTOPLACE_SECRET,
    call_id: String(body.callid),
    status,
    phone: normalizePhone(body.phone),
    extension_id: String(body.ext)
  };

  console.log(
    'RestoPlace request:',
    JSON.stringify({
      ...payload,
      secret: '***'
    })
  );

  const response = await fetch(RESTOPLACE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  console.log(
    'RestoPlace response:',
    response.status,
    responseText
  );

  if (!response.ok) {
    throw new Error(
      `RestoPlace returned ${response.status}: ${responseText}`
    );
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/finenumbers/webhook', async (req, res) => {
  try {
    const body = req.body || {};

    console.log(
      'Fine Numbers request:',
      JSON.stringify({
        cmd: body.cmd,
        type: body.type,
        status: body.status,
        direction: body.direction,
        phone: body.phone,
        ext: body.ext,
        user: body.user,
        callid: body.callid
      })
    );

    if (
      process.env.FINE_TOKEN &&
      body.crm_token !== process.env.FINE_TOKEN
    ) {
      console.log('Invalid Fine Numbers token');

      return res.status(401).json({
        error: 'Invalid token'
      });
    }

    // Fine Numbers asks CRM for contact information.
    // We currently do not resolve guest names or responsible users here.
    if (body.cmd === 'contact') {
      return res.status(200).json({
        contact_name: '',
        responsible: ''
      });
    }

    let restoplaceStatus = null;

    if (body.cmd === 'event') {
      // RestoPlace integration is only for incoming calls.
      if (body.direction && body.direction !== 'in') {
        return okIgnored(res, 'non-incoming event');
      }

      switch (body.type) {
        case 'INCOMING':
          restoplaceStatus = 'call';
          break;

        case 'ACCEPTED':
          restoplaceStatus = 'talking';
          break;

        case 'COMPLETED':
          restoplaceStatus = 'ended';
          break;

        case 'CANCELLED':
          // Required so a cancelled ringing call does not remain
          // hanging as active in RestoPlace.
          restoplaceStatus = 'missed';
          break;

        case 'TRANSFERRED':
          return okIgnored(res, 'transferred');

        case 'OUTGOING':
          return okIgnored(res, 'outgoing');

        default:
          return okIgnored(res, `unknown event: ${body.type || ''}`);
      }
    } else if (body.cmd === 'history') {
      // Fine Numbers history uses type=in/out.
      if (body.type !== 'in') {
        return okIgnored(res, 'non-incoming history');
      }

      switch (body.status) {
        case 'Success':
          // Fallback for a lost COMPLETED realtime event.
          restoplaceStatus = 'ended';
          break;

        case 'Missed':
        case 'Cancel':
          // Fallback for a lost CANCELLED realtime event.
          restoplaceStatus = 'missed';
          break;

        default:
          return okIgnored(
            res,
            `unsupported history status: ${body.status || ''}`
          );
      }
    } else {
      return okIgnored(res, `unsupported command: ${body.cmd || ''}`);
    }

    await sendToRestoplace(body, restoplaceStatus);

    return res.status(200).json({
      ok: true,
      restoplace_status: restoplaceStatus
    });
  } catch (error) {
    console.error('Adapter error:', error);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Telephony adapter listening on port ${PORT}`);
});
