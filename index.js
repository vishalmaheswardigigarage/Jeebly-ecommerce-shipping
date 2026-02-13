import crypto from 'crypto';
import express from "express";
import serveStatic from "serve-static";
import shopify from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { join } from "path";
import { readFileSync } from "fs";
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const PORT = parseInt(
    process.env.BACKEND_PORT || process.env.PORT || "3001",
    10
);

const STATIC_PATH =
    process.env.NODE_ENV === "production"
        ? `${process.cwd()}/dist/`
        : `${process.cwd()}/dist/`;

const app = express();

// Middleware to capture raw body for HMAC verification..
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString(); // Capture the raw body as a string
    }
}));


let shopId = '';



// Function to verify the Shopify webhook HMAC
function verifyShopifyWebhook(req) {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (!hmac) return false;  // Return false if HMAC is missing

    const body = req.rawBody;
    const generatedHash = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(body, 'utf8')
        .digest('base64');

    return generatedHash === hmac;
}

// Webhook endpoint..
let payload = null;


const lastSuccessfulShipments = {};

// Webhook handler
app.post('/api/webhooks/ordercreate', async (req, res) => {
    // Webhooks from Shopify identify the shop in the header
    const shop = req.headers['x-shopify-shop-domain'];

    if (!verifyShopifyWebhook(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const payload = req.body;
        const shippingTitle = payload?.shipping_lines?.[0]?.title;

        // Load offline session for tracking updates
        let session = undefined;
        if (shop) {
            const sessionId = shopify.api.session.getOfflineId(shop);
            session = await shopify.config.sessionStorage.loadSession(sessionId);
        } else {
            console.warn("No shop header found in webhook. Tracking updates may fail.");
        }

        // res.status(200).json({ success: true, message: 'Webhook received' });
        const orderId = payload?.id;
        // console.log("webhook request data",req.query.shopid).

        const orderStatusUrl = payload.order_status_url;



        // Use a regular expression to extract the shop ID from the URL
        const shopIdMatch = orderStatusUrl.match(/\/(\d+)\/orders/);
        const extractedShopId = shopIdMatch ? shopIdMatch[1] : null; // Capturing group 1 contains the shop ID
        console.log(`Webhook received for order ID: ${orderId}, Timestamp: ${new Date().toISOString()}`);
        console.log("Extracted Shop ID:", extractedShopId);
        console.log("Webhook received:", payload);
        console.log("session for Tracking:", session);

        console.log("Webhook payload:", payload);




        // new code added 07/05/2025

        // if (!orderId || !extractedShopId) {
        //   throw new Error("Missing order ID or shop ID.");
        // }

        // new code added 07/05/2025

        // Process webhook data
        // OPTIMIZATION: Pass session to allow tracking updates
        await processWebhookData(payload, extractedShopId, session,shippingTitle);

        res.status(200).json({ success: true, message: 'Webhook received' });

    } catch (error) {
        console.error('Error processing webhook:', error);

    }
});



// if (!session) {
//   console.error('No session found for shop:', shop);
//   return;
// }

// const order = new shopify.api.rest.Order({ session })s;
// order.id = payload.id;
// order.tags = (payload.tags || '') + ',created_by_webhook';

// await order.save({
//   update: true
// });


async function processWebhookData(payload, extractedShopId, session,shippingTitle) {
    console.log("Processing webhook data:", JSON.stringify(payload, null, 2));


    //   // Fetch the default address and configure dat.
    const [defaultAddress, getConfigure] = await Promise.all([
        fetchDefaultAddress(extractedShopId),
        fetchConfigureData(extractedShopId)
    ]);

    if (!defaultAddress) {
        console.error("No default address found. Shipment creation aborted.");
        return;
    }

    // Extract data from the webhook payload.
    const description =
        payload?.line_items?.length > 0
            ? payload.line_items.map(item => {
                const details = [];

                if (item?.sku && item.sku !== "no sku found") {
                    details.push(`SKU: ${item.sku}`);
                }

                if (item?.title && item.title !== "title not defined") {
                    details.push(`SKU Name: ${item.title}`);
                }

                if (item?.variant_title && item.variant_title !== "size and colors not defined") {
                    details.push(`Color & Size: ${item.variant_title}`);
                }

                if (item?.quantity != null) {
                    details.push(`Qty: ${item.quantity}`);
                }

                if (item?.grams != null && item.grams > 0) {
                    let weightKg = (item.grams / 1000).toFixed(1); // Convert grams to KG
                    details.push(`Weight: ${weightKg} kg`);
                }

                return details.join(', ');
            }).join(' | ')
            : "";

    // | ${item?.grams || ""}.........
    const weight = Math.round(payload?.line_items?.[0]?.grams || 1000);
    const codAmount = parseFloat(payload?.total_price) || 0;
    const pieces = payload?.line_items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    const timeZone = payload?.line_items?.timezone || "00:00";
    const dropoffName = payload?.shipping_address?.name || "Unknown";
    const dropoffPhone = payload?.shipping_address?.phone || "Unknown";
    const selectedArea = `${payload?.shipping_address?.address1 || ""} ${payload?.shipping_address?.address2 || ""}`.trim() || "Unknown Area";
    const selectedCity = payload?.shipping_address?.province || "";
    const orderNumber = payload?.order_number || "#001";
    const paymentType = payload?.financial_status === "paid" ? "Prepaid" : "COD";
    const codAmountToUse = paymentType === "Prepaid" ? 0.00 : codAmount;
    const pickupDate = getNextDayDate();
    const clientKey = extractedShopId;
    const OrderId = payload.id;
    const Ship_type = shippingTitle;
    const country = payload.country;

    console.log("Extracted Data for Shipment:", {
        description,
        weight,
        codAmountToUse,
        pieces,
        dropoffName,
        dropoffPhone,
        selectedArea,
        selectedCity,
        paymentType,
        pickupDate,
        defaultAddress,
        orderNumber,
        getConfigure,
        clientKey,
        timeZone,
        OrderId,
        country,
        Ship_type 
    });

    // Call the createShipment function with the extracted data
    await createShipment({
        description,
        weight,
        codAmountToUse,
        pieces,
        dropoffName,
        dropoffPhone,
        selectedArea,
        selectedCity,
        pickupDate,
        paymentType,
        defaultAddress,
        orderNumber,
        getConfigure,
        clientKey,
        timeZone,
        session,
        country,
        Ship_type
    });

    // // Function to call the bookshipment API
    async function createShipment({
        description,
        weight,
        codAmountToUse,
        pieces,
        dropoffName,
        dropoffPhone,
        selectedArea,
        selectedCity,
        paymentType,
        defaultAddress,
        orderNumber,
        pickupDate,
        getConfigure,
        clientKey,
        timezone,
        session,
        country,
        Ship_type
    }) {


        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const now = Date.now();

        // Check if this order was recently processed
        const lastTime = lastSuccessfulShipments[orderNumber];
        const oneMinute = 60 * 1000;

        if (lastTime && now - lastTime < oneMinute) {
            const waitTime = oneMinute - (now - lastTime);
            console.log(`Order ${orderNumber} was processed recently. Waiting ${waitTime / 1000}s...`);
            await delay(waitTime);
        }

        // Fetch the stored client key from the API


        const url = `https://myjeebly.jeebly.com/app/create_shipment_webhook?client_key=${clientKey}`;
        const body = JSON.stringify({
            client_key: clientKey,
            delivery_type: getConfigure.service_type || "Next Day",
            load_type: getConfigure.courier_type || "Non-document",
            consignment_type: "FORWARD",
            description: description,
            weight: weight || "1000",
            payment_type: paymentType,
            cod_amount: codAmountToUse || "0.00",
            num_pieces: pieces,
            customer_reference_number: orderNumber || "",
            origin_address_name: defaultAddress.addr_contact_person || "",
            origin_address_mob_no_country_code: "",
            origin_address_mobile_number: defaultAddress.addr_mobile_number || "",
            origin_address_house_no: defaultAddress.addr_house_no || "",
            origin_address_building_name: defaultAddress.addr_building_name || "",
            origin_address_area: defaultAddress.addr_area,
            origin_address_landmark: defaultAddress.addr_landmark,
            origin_address_city: defaultAddress.addr_city || "",
            origin_address_type: "Normal",
            origin_address_country:addr_country || "",
            destination_address_name: dropoffName || "",
            destination_address_mob_no_country_code: "",
            destination_address_mobile_number: dropoffPhone || "",
            destination_address_country:country||"",
            destination_address_house_no: "",
            destination_address_building_name: "",
            destination_address_area: selectedArea || "",
            destination_address_landmark: "",
            destination_address_city: selectedCity || "",
            destination_address_type: "Normal",
            pickup_date: pickupDate || "2024-09-12",
            time_zone: timezone || "00:00",
            Ship_type: Ship_type 
        });

        console.log("Creating shipment with the following payload:");

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: body
            });

            console.log(`Shipment API Response Status: ${response.status}`);

            const responseBody = await response.json();
            console.log("Shipment API Response Body:", responseBody);

            if (response.ok) {
                console.log("Shipment created successfully:", responseBody);
                // === Extract tracking / AWB number ===
                const trackingNumber = responseBody["AWB No"];

                if (!trackingNumber) {
                    console.error("No AWB / Tracking Number found in API response.");
                    return;
                }

                console.log("Calling Shopify tracking update with:", {
                    orderId: OrderId,
                    trackingNumber
                });


                // === Call backend tracking update ===
                // OPTIMIZATION: Updated to use shared logic directly instead of duplicate fetch
                // const result = await updateTrackingDirect(OrderId, trackingNumber);

                const result = await updateOrderTracking(session, OrderId, trackingNumber);

                console.log("Tracking update result:", result);
                // updateTrackingDirect(OrderId, trackingNumber); // Removed redundant call
            }

            else {
                console.error("Failed to create shipment:", responseBody);
            }
        } catch (error) {
            console.error("Network error while creating shipment:", error);
        }
    }
}

// Function to fetch the default address
async function fetchDefaultAddress(extractedShopId) {

    const clientKey = extractedShopId;

    if (!clientKey) {
        console.error("fetchDefaultAddress: Missing clientKey (extractedShopId). Aborting fetch.");
        return null;
    }

    // Fetch the stored client key from the APi

    const url = `https://myjeebly.jeebly.com/app/get_address?client_key=${clientKey}`;

    console.log("Fetching default address from:", url);

    try {
        const response = await fetch(url, { method: "GET" });
        console.log(`Default Address API Response Status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("Default Address API Response Body:", data);

        if (data && data.success === "true" && Array.isArray(data.address)) {
            const defaultAddr = data.address.find(addr => addr.default_address === "1");
            if (defaultAddr) {
                console.log("Default address found:", defaultAddr);
                return defaultAddr;
            } else {
                console.error("No default address found in the response.");
                return null;
            }
        }
    } catch (error) {
        console.error("Error fetching default address:", error);
    }
    return null; // Return null if no default address is found or if an error occurs
}
// // Fetch configuration data from the get_configuration API
async function fetchConfigureData(extractedShopId) {
    // Fetch the stored client key from the api
    const clientKey = extractedShopId;
    const url = `https://myjeebly.jeebly.com/app/get_configuration?client_key=${clientKey}`;

    console.log("Fetching configuration data from:", url);

    try {
        const response = await fetch(url, { method: "GET" });
        console.log(`Configuration API Response Status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("Configuration API Response Body:", data);

        if (data && data.success) {
            return data; // Return configuration data if successf
        }
    } catch (error) {
        console.error("Error fetching configuration data:", error);
    }
    return null; // Return null if no configuration data is found or if an error occurs
}

// Utility function to get the next day's date in the required format
function getNextDayDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0]; // Format as YYYY-MM-DD
}

// Endpoint to get the latest webhook data....

app.get('/api/webhooks/latest', (_req, res) => {
    if (payload) {
        return res.status(200).json({ success: true, data: payload });
    } else {
        return res.status(204).json({ success: false, message: 'No webhook data available' });
    }
});

// Set up Shopify authentication and webhook handling
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

// hear the code...//
app.use("/api/*", shopify.validateAuthenticatedSession());


app.get("/api/shop/all", async (_req, res) => {
    try {
        const shopData = await shopify.api.rest.Shop.all({
            // const shopData = await shopify.api.rest.Shop.current({
            session: res.locals.shopify.session,
        });
        shopId = shopData.data[0].id
        console.log("endpoint of shop data", shopData)
        // res.status(200).json({ success: true, data:shopData});
        res.status(200).json({ success: true, data: shopData });

    } catch (error) {
        console.error('Error fetching shopdata:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
});


// MOVED from bottom: Update tracking using REST API (Open endpoint, requires 'shop' for offline session)
app.post("/api/update-tracking", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { orderId, trackingNumber } = req.body;

    if (!orderId || !trackingNumber) {
      return res.json({ success: false, error: "Missing orderId or trackingNumber" });
    }

    
    const numericOrderId = Number(orderId);
    // --------------------------------------------------------------------
    // STEP 1: Get fulfillment orders (IMPORTANT: new API!)
    // --------------------------------------------------------------------
    const fulfillmentOrders = await shopify.api.rest.FulfillmentOrder.all({
      session,
      order_id: numericOrderId,
    });

    if (!fulfillmentOrders.data.length) {
      return res.json({ success: false, error: "No Fulfillment Orders found."});
    }

    const fulfillmentOrder = fulfillmentOrders.data[0];

    // --------------------------------------------------------------------
    // STEP 2: Check if fulfillment already exists
    // --------------------------------------------------------------------
    const fulfillments = await shopify.api.rest.Fulfillment.all({
      session,
      order_id: numericOrderId,
    });

    if (fulfillments.data.length > 0) {
      // ================
      // UPDATE TRACKING
      // ================
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

    // --------------------------------------------------------------------
    // STEP 3: NO fulfillment exists → CREATE new fulfillment
    // --------------------------------------------------------------------
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
        // Fetch all orders from Shopify API...
        const orderData = await shopify.api.rest.Order.all({
            session: res.locals.shopify.session,
            status: "any"
        });

        // Filter orders where cancel_reason is null..
        const filteredOrders = orderData.data.filter(order => order.cancel_reason === null);

        // Send the filtered orders as the response
        res.status(200).json({ success: true, data: filteredOrders });
        console.log("Filtered order data retrieved successfully");
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
});

// OPTIMIZATION: Shared function for tracking updates
async function updateOrderTracking(session, orderId, trackingNumber) {
    try {
        if (!orderId || !trackingNumber) {
            return { success: false, error: "Missing orderId or trackingNumber" };
        }

        const numericOrderId = Number(orderId);

        // --------------------------------------------------------------------
        // STEP 1: Get fulfillment orders (IMPORTANT: new API!)
        // --------------------------------------------------------------------
        const fulfillmentOrders = await shopify.api.rest.FulfillmentOrder.all({
            session,
            order_id: numericOrderId,
        });

        if (!fulfillmentOrders.data.length) {
            return { success: false, error: "No Fulfillment Orders found." };
        }

        const fulfillmentOrder = fulfillmentOrders.data[0];

        // --------------------------------------------------------------------
        // STEP 2: Check if fulfillment already exists
        // --------------------------------------------------------------------
        const fulfillments = await shopify.api.rest.Fulfillment.all({
            session,
            order_id: numericOrderId,
        });

        if (fulfillments.data.length > 0) {
            // ================
            // UPDATE TRACKING
            // ================
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

        // --------------------------------------------------------------------
        // STEP 3: NO fulfillment exists → CREATE new fulfillment
        // --------------------------------------------------------------------
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

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

// ensure install

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
    return res
        .status(200)
        .set("Content-Type", "text/html")
        .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});