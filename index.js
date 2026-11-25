import crypto from 'crypto';
import express from "express";
import serveStatic from "serve-static";
import shopify from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { join } from "path";
import { readFileSync } from "fs";
import dotenv from 'dotenv';
dotenv.config();

// NOTE: the old `import fetch from 'node-fetch'` is removed.
// Node 18+ (you run Node 22 on Vercel) has a built-in global fetch.

const PORT = parseInt(
    process.env.BACKEND_PORT || process.env.PORT || "3001",
    10
);

const STATIC_PATH = `${process.cwd()}/dist/`;

const JEEBLY_BASE = 'https://myjeebly.jeebly.com/app';
const JEEBLY_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Detailed logging
// Detailed logs (webhook payload, Jeebly request/response bodies) are ON by default.
// To turn them off, set the env variable VERBOSE_LOGS=false in Vercel.
// The access token is ALWAYS redacted in logs.
// ---------------------------------------------------------------------------
const VERBOSE_LOGS = process.env.VERBOSE_LOGS !== 'false';

function vlog(label, data) {
    if (!VERBOSE_LOGS) return;
    if (data === undefined) {
        console.log(label);
        return;
    }
    console.log(label, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

function redactSession(session) {
    if (!session) return session;
    return {
        ...session,
        accessToken: session.accessToken ? '[REDACTED]' : undefined,
        refreshToken: session.refreshToken ? '[REDACTED]' : undefined,
    };
}

const app = express();

// Middleware to capture raw body for HMAC verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString(); // Capture the raw body as a string
    }
}));

let shopId = '';
let payload = null; // used only by /api/webhooks/latest

// ---------------------------------------------------------------------------
// Verify the Shopify webhook HMAC
// ---------------------------------------------------------------------------
function verifyShopifyWebhook(req) {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (!hmac || !req.rawBody) return false;

    const generatedHash = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(req.rawBody, 'utf8')
        .digest('base64');

    const a = Buffer.from(generatedHash);
    const b = Buffer.from(hmac);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Order create webhook: verify -> process -> ALWAYS respond
// ---------------------------------------------------------------------------
const skip = (reason) => ({ status: 'skipped', reason });
const failed = (reason) => ({ status: 'failed', reason });
const created = (reason) => ({ status: 'created', reason });

app.post('/api/webhooks/ordercreate', async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const shop = req.headers['x-shopify-shop-domain'];
    const orderPayload = req.body;
    const orderId = orderPayload?.id;

    console.log(`Webhook received for order ID: ${orderId}, Timestamp: ${new Date().toISOString()}`);
    vlog('Webhook payload:', orderPayload);

    try {
        const result = await processOrder(orderPayload, shop);
        const line = `Order ${orderId} (${shop}): ${result.status} - ${result.reason}`;
        if (result.status === 'failed') console.error(line);
        else console.log(line);
    } catch (error) {
        // Never leave Shopify without a response
        console.error(`Order ${orderId} (${shop}): unexpected error - ${error.message}`);
    }

    return res.status(200).json({ success: true });
});

async function processOrder(orderPayload, shop) {
    const orderId = orderPayload?.id;
    if (!orderId) return skip('no order id');

    // 1. Orders that can never become a shipment
    const ship = orderPayload.shipping_address;
    if (!ship) return skip('no shipping address (POS or digital order)');
    // Optional: remove this line if already-fulfilled orders should still get a Jeebly shipment
    if (orderPayload.fulfillment_status === 'fulfilled') return skip('order already fulfilled');
    if (!orderPayload.line_items?.some((item) => item.requires_shipping)) {
        return skip('no shippable items');
    }

    // 2. Required shipping fields
    const selectedArea = `${ship.address1 || ''} ${ship.address2 || ''}`.trim();
    const selectedCity = ship.province || ship.city || '';
    const country = ship.country || '';
    const missing = [];
    if (!selectedArea) missing.push('address');
    if (!selectedCity) missing.push('city');
    if (!country) missing.push('country');
    if (missing.length) return skip(`missing shipping fields: ${missing.join(', ')}`);

    // 3. Jeebly client key (shop id) and the offline session
    const clientKey = orderPayload.order_status_url?.match(/\/(\d+)\/orders/)?.[1];
    if (!clientKey) return skip('could not read shop id from order_status_url');
    console.log('Extracted Shop ID:', clientKey);
    if (!shop) return skip('no shop domain header');

    const session = await shopify.config.sessionStorage.loadSession(
        shopify.api.session.getOfflineId(shop)
    );
    vlog('session for Tracking:', redactSession(session));
    if (!session) return skip('no offline session (app uninstalled?)');

    // 4. Both supporting Jeebly APIs must succeed before creating a shipment
    const [defaultAddress, getConfigure] = await Promise.all([
        fetchDefaultAddress(clientKey),
        fetchConfigureData(clientKey),
    ]);
    if (!defaultAddress) return skip('Jeebly default address not available');
    if (!getConfigure) return skip('Jeebly configuration not available');

    // 5. Build the shipment
    const paymentType = orderPayload.financial_status === 'paid' ? 'Prepaid' : 'COD';
    const codAmount = paymentType === 'Prepaid' ? 0.0 : parseFloat(orderPayload.total_price) || 0;
    const pieces = orderPayload.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const dropoffPhone =
        ship.phone || orderPayload.billing_address?.phone || orderPayload.customer?.phone || 'Unknown';
    const description = buildDescription(orderPayload);
    const weight = Math.round(orderPayload.line_items?.[0]?.grams || 1000);
    const pickupDate = getNextDayDate();
    const shipType = orderPayload.shipping_lines?.[0]?.title;

    vlog('Extracted Data for Shipment:', {
        description,
        weight,
        codAmountToUse: codAmount,
        pieces,
        dropoffName: ship.name || 'Unknown',
        dropoffPhone,
        selectedArea,
        selectedCity,
        paymentType,
        pickupDate,
        defaultAddress,
        orderNumber: orderPayload.order_number,
        getConfigure,
        clientKey,
        OrderId: orderId,
        Ship_type: shipType,
        country,
    });

    const body = {
        client_key: clientKey,
        delivery_type: getConfigure.service_type || 'Next Day',
        load_type: getConfigure.courier_type || 'Non-document',
        consignment_type: 'FORWARD',
        description,
        weight,
        payment_type: paymentType,
        cod_amount: codAmount || '0.00',
        num_pieces: pieces,
        customer_reference_number: orderPayload.order_number || '',
        origin_address_name: defaultAddress.addr_contact_person || '',
        origin_address_mob_no_country_code: '',
        origin_address_mobile_number: defaultAddress.addr_mobile_number || '',
        origin_address_house_no: defaultAddress.addr_house_no || '',
        origin_address_building_name: defaultAddress.addr_building_name || '',
        origin_address_area: defaultAddress.addr_area,
        origin_address_landmark: defaultAddress.addr_landmark,
        origin_address_city: defaultAddress.addr_city || '',
        origin_address_type: 'Normal',
        destination_address_name: ship.name || 'Unknown',
        destination_address_mob_no_country_code: '',
        destination_address_mobile_number: dropoffPhone,
        destination_address_house_no: '',
        destination_address_building_name: '',
        destination_address_area: selectedArea,
        destination_address_landmark: '',
        destination_address_city: selectedCity,
        destination_address_type: 'Normal',
        pickup_date: pickupDate,
        time_zone: '00:00',
        Ship_type: shipType,
        destination_address_country: country,
    };

    // 6. Create the shipment
    vlog('Creating shipment with the following payload:', body);

    const response = await fetch(
        `${JEEBLY_BASE}/create_shipment_webhook?client_key=${clientKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(JEEBLY_TIMEOUT_MS),
        }
    );
    const data = await response.json().catch(() => ({}));
    const message = String(data?.message || '');

    vlog(`Shipment API Response Status: ${response.status}`);
    vlog('Shipment API Response Body:', data);

    if (/webhook off/i.test(message)) {
        return skip('Jeebly webhook is OFF for this client');
    }
    if (!response.ok || data?.success === 'false' || data?.success === false) {
        return failed(`Jeebly create_shipment ${response.status}: ${message}`);
    }

    const awb = data['AWB No'];
    if (!awb) return failed('Jeebly response has no AWB number');

    // 7. Only now update Shopify tracking
    vlog('Calling Shopify tracking update with:', { orderId, trackingNumber: awb });
    const tracking = await updateOrderTracking(session, orderId, awb);
    vlog('Tracking update result:', tracking);

    if (!tracking.success) {
        return failed(`shipment ${awb} created but tracking update failed: ${tracking.error}`);
    }
    return created(`AWB ${awb}`);
}

function buildDescription(orderPayload) {
    return (orderPayload.line_items || [])
        .map((item) => {
            const d = [];
            if (item.sku && item.sku !== 'no sku found') d.push(`SKU: ${item.sku}`);
            if (item.title && item.title !== 'title not defined') d.push(`SKU Name: ${item.title}`);
            if (item.variant_title && item.variant_title !== 'size and colors not defined') {
                d.push(`Color & Size: ${item.variant_title}`);
            }
            if (item.quantity != null) d.push(`Qty: ${item.quantity}`);
            if (item.grams > 0) d.push(`Weight: ${(item.grams / 1000).toFixed(1)} kg`);
            return d.join(', ');
        })
        .join(' | ');
}

// ---------------------------------------------------------------------------
// Jeebly helper APIs
// ---------------------------------------------------------------------------
async function jeeblyGet(path, clientKey, label) {
    const url = `${JEEBLY_BASE}/${path}?client_key=${clientKey}`;
    vlog(`Fetching ${label} from:`, url);

    const response = await fetch(url, {
        signal: AbortSignal.timeout(JEEBLY_TIMEOUT_MS),
    });
    vlog(`${label} API Response Status: ${response.status}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);

    const data = await response.json();
    vlog(`${label} API Response Body:`, data);
    return data;
}

async function fetchDefaultAddress(clientKey) {
    try {
        const data = await jeeblyGet('get_address', clientKey, 'Default Address');
        if (data?.success === 'true' && Array.isArray(data.address)) {
            const defaultAddr = data.address.find((a) => a.default_address === '1');
            if (defaultAddr) {
                vlog('Default address found:', defaultAddr);
                return defaultAddr;
            }
            console.error('No default address found in the response.');
        }
    } catch (error) {
        console.error('get_address failed:', error.message);
    }
    return null;
}

async function fetchConfigureData(clientKey) {
    try {
        const data = await jeeblyGet('get_configuration', clientKey, 'Configuration');
        // Old code used `if (data.success)`, which is also true for the string 'false'
        if (data?.success === 'true' || data?.success === true) return data;
    } catch (error) {
        console.error('get_configuration failed:', error.message);
    }
    return null;
}

// Utility: next day's date as YYYY-MM-DD
function getNextDayDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
}

// Endpoint to get the latest webhook data
app.get('/api/webhooks/latest', (_req, res) => {
    if (payload) {
        return res.status(200).json({ success: true, data: payload });
    } else {
        return res.status(204).json({ success: false, message: 'No webhook data available' });
    }
});

// ---------------------------------------------------------------------------
// Shopify authentication and webhook handling
// ---------------------------------------------------------------------------
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
    shopify.config.auth.callbackPath,
    shopify.auth.callback(),
    shopify.redirectToShopifyOrAppRoot()
);
app.post(
    shopify.config.webhooks.path,
    shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// All routes below need an authenticated Shopify session
app.use("/api/*", shopify.validateAuthenticatedSession());

app.get("/api/shop/all", async (_req, res) => {
    try {
        const shopData = await shopify.api.rest.Shop.all({
            session: res.locals.shopify.session,
        });
        shopId = shopData.data[0].id;
        res.status(200).json({ success: true, data: shopData });
    } catch (error) {
        console.error('Error fetching shopdata:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
});

// Update tracking using REST API
app.post("/api/update-tracking", async (req, res) => {
    try {
        const session = res.locals.shopify.session;
        const { orderId, trackingNumber } = req.body;

        if (!orderId || !trackingNumber) {
            return res.json({ success: false, error: "Missing orderId or trackingNumber" });
        }

        const numericOrderId = Number(orderId);

        // STEP 1: Get fulfillment orders
        const fulfillmentOrders = await shopify.api.rest.FulfillmentOrder.all({
            session,
            order_id: numericOrderId,
        });

        if (!fulfillmentOrders.data.length) {
            return res.json({ success: false, error: "No Fulfillment Orders found." });
        }

        const fulfillmentOrder = fulfillmentOrders.data[0];

        // STEP 2: Check if fulfillment already exists
        const fulfillments = await shopify.api.rest.Fulfillment.all({
            session,
            order_id: numericOrderId,
        });

        if (fulfillments.data.length > 0) {
            // UPDATE TRACKING
            const fulfillmentId = fulfillments.data[0].id;

            const fulfillment = new shopify.api.rest.Fulfillment({ session });
            fulfillment.id = fulfillmentId;

            const updateResponse = await fulfillment.update_tracking({
                body: {
                    fulfillment: {
                        notify_customer: false,
                        tracking_info: {
                            number: trackingNumber,
                            company: "Others",
                        },
                    },
                },
            });

            return res.json({
                success: true,
                error: "Tracking update did not return status 200",
                data: updateResponse,
            });
        }

        // STEP 3: No fulfillment exists -> CREATE new fulfillment
        const createFulfillment = new shopify.api.rest.Fulfillment({ session });

        createFulfillment.line_items_by_fulfillment_order = [
            {
                fulfillment_order_id: fulfillmentOrder.id, // REQUIRED
            },
        ];

        createFulfillment.tracking_info = {
            number: trackingNumber,
            company: "Others",
            url: `https://www.my-shipping-company.com?tracking_number=${trackingNumber}`,
        };

        const newFulfillmentResponse = await createFulfillment.save({
            update: true,
        });

        return res.json({
            success: true,
            message: "New fulfillment created & tracking added",
            data: newFulfillmentResponse,
        });

    } catch (error) {
        console.error("Tracking update error:", error);
        res.json({
            success: false,
            error: error.message,
        });
    }
});

app.get("/api/orders/all", async (_req, res) => {
    try {
        // Fetch all orders from Shopify API
        const orderData = await shopify.api.rest.Order.all({
            session: res.locals.shopify.session,
            status: "any"
        });

        // Filter orders where cancel_reason is null
        const filteredOrders = orderData.data.filter(order => order.cancel_reason === null);

        res.status(200).json({ success: true, data: filteredOrders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Shared tracking update (used by the webhook flow)
// ---------------------------------------------------------------------------
async function updateOrderTracking(session, orderId, trackingNumber) {
    try {
        if (!orderId || !trackingNumber) {
            return { success: false, error: "Missing orderId or trackingNumber" };
        }

        const numericOrderId = Number(orderId);

        // STEP 1: Get fulfillment orders
        const fulfillmentOrders = await shopify.api.rest.FulfillmentOrder.all({
            session,
            order_id: numericOrderId,
        });

        if (!fulfillmentOrders.data.length) {
            return { success: false, error: "No Fulfillment Orders found." };
        }

        const fulfillmentOrder = fulfillmentOrders.data[0];

        // STEP 2: Check if fulfillment already exists
        const fulfillments = await shopify.api.rest.Fulfillment.all({
            session,
            order_id: numericOrderId,
        });

        if (fulfillments.data.length > 0) {
            // UPDATE TRACKING
            const fulfillmentId = fulfillments.data[0].id;

            const fulfillment = new shopify.api.rest.Fulfillment({ session });
            fulfillment.id = fulfillmentId;

            const updateResponse = await fulfillment.update_tracking({
                body: {
                    fulfillment: {
                        notify_customer: false,
                        tracking_info: {
                            number: trackingNumber,
                            company: "Others",
                        },
                    },
                },
            });

            return {
                success: true,
                message: "Tracking updated successfully",
                data: updateResponse,
            };
        }

        // STEP 3: No fulfillment exists -> CREATE new fulfillment
        const createFulfillment = new shopify.api.rest.Fulfillment({ session });

        createFulfillment.line_items_by_fulfillment_order = [
            {
                fulfillment_order_id: fulfillmentOrder.id, // REQUIRED
            },
        ];

        createFulfillment.tracking_info = {
            number: trackingNumber,
            company: "Others",
            url: `https://www.my-shipping-company.com?tracking_number=${trackingNumber}`,
        };

        const newFulfillmentResponse = await createFulfillment.save({
            update: true,
        });

        return {
            success: true,
            message: "New fulfillment created & tracking added",
            data: newFulfillmentResponse,
        };

    } catch (error) {
        console.error("Tracking update error:", error);
        return {
            success: false,
            error: error.message,
        };
    }
}

// ---------------------------------------------------------------------------
// Static files and app shell
// ---------------------------------------------------------------------------
app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

// Ensure the app is installed on the shop
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
    return res
        .status(200)
        .set("Content-Type", "text/html")
        .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});