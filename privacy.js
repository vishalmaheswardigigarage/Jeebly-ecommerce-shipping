
// import { DeliveryMethod } from '@shopify/shopify-api';

// /**
//  * @type {{[key: string]: import('@shopify/shopify-api').WebhookHandler}}
//  */
// const PrivacyWebhookHandlers = {
//   /**
//    * Customers can request their data from a store owner. When this happens,
//    * Shopify invokes this privacy webhook.
//    *
//    * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-data_request
//    */
//   CUSTOMERS_DATA_REQUEST: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks',
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       // Payload has the following shape:
//       // {
//       //   "shop_id": 954889,
//       //   "shop_domain": "{shop}.myshopify.com",
//       //   "orders_requested": [
//       //     299938,
//       //     280263,
//       //     220458
//       //   ],
//       //   "customer": {
//       //     "id": 191167,
//       //     "email": "john@example.com",
//       //     "phone": "555-625-1199"
//       //   },
//       //   "data_request": {
//       //     "id": 9999
//       //   }
//       // }
//     },
//   },

//   /**
//    * Store owners can request that data is deleted on behalf of a customer. When
//    * this happens, Shopify invokes this privacy webhook.
//    *
//    * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-redact
//    */
//   CUSTOMERS_REDACT: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks',
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       // Payload has the following shape:
//       // {
//       //   "shop_id": 954889,
//       //   "shop_domain": "{shop}.myshopify.com",
//       //   "customer": {
//       //     "id": 191167,
//       //     "email": "john@example.com",
//       //     "phone": "555-625-1199"
//       //   },
//       //   "orders_to_redact": [
//       //     299938,
//       //     280263,
//       //     220458
//       //   ]
//       // }
//     },
//   },

//   /**
//    * 48 hours after a store owner uninstalls your app, Shopify invokes this
//    * privacy webhook.
//    *
//    * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#shop-redact
//    */
//   SHOP_REDACT: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks',
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       // Payload has the following shape:
//       // {
//       //   "shop_id": 954889,
//       //   "shop_domain": "{shop}.myshopify.com"
//       // }
//     },
//   },

//   ORDERS_CREATE: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks/orders/create',
//     callback: async (topic, shop, body, webhookId) => {
//       try {
//         const payload = JSON.parse(body);

//         // Define the URL of your dummy test API
//         const testApiUrl = 'https://webhook-test.com/b91fab50f1dac94562f9c02df9417402';

//         // Send the payload to the test API
//         const response = await fetch(testApiUrl, {
//           method: 'POST',
//           headers: {
//             'Content-Type': 'application/json',
//           },
//           body: JSON.stringify({
//             topic,
//             shop,
//             payload,
//             webhookId,
//           }),
//         });

//         // Check if the request was successful
//         if (!response.ok) {
//           console.error(`Failed to send webhook data: ${response.statusText}`);
//         } else {
//           console.log('Webhook data sent successfully.');
//         }
//       } catch (error) {
//         console.error('Error handling webhook:', error);
//       }
//     },
//   },

// };

// export default PrivacyWebhookHandlers;.......






import { DeliveryMethod } from '@shopify/shopify-api';

/**
 * @type {{[key: string]: import('@shopify/shopify-api').WebhookHandler}}
 */
let recentWebhookPayload = {};

// const PrivacyWebhookHandlers = {
//   /**
//    * Customers can request their data from a store owner. When this happens,
//    * Shopify invokes this privacy webhook.
//    *
//    * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-data_request
//    */
  
//   CUSTOMERS_DATA_REQUEST: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks',
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       // Payload has the following shape:
//       // {
//       //   "shop_id": 954889,
//       //   "shop_domain": "{shop}.myshopify.com",
//       //   "orders_requested": [
//       //     299938,
//       //     280263,
//       //     220458
//       //   ],
//       //   "customer": {
//       //     "id": 191167,
//       //     "email": "john@example.com",
//       //     "phone": "555-625-1199"
//       //   },
//       //   "data_request": {
//       //     "id": 9999
//       //   }
//       // }
//     },
//   },

//   /**
//    * Store owners can request that data is deleted on behalf of a customer. When
//    * this happens, Shopify invokes this privacy webhook.
//    *
//    * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-redact
//    */
//   CUSTOMERS_REDACT: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks',
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       // Payload has the following shape:
//       // {
//       //   "shop_id": 954889,
//       //   "shop_domain": "{shop}.myshopify.com",
//       //   "customer": {
//       //     "id": 191167,
//       //     "email": "john@example.com",
//       //     "phone": "555-625-1199"
//       //   },
//       //   "orders_to_redact": [
//       //     299938,
//       //     280263,
//       //     220458
//       //   ]
//       // }
//     },
//   },

//   /**
//    * 48 hours after a store owner uninstalls your app, Shopify invokes this
//    * privacy webhook.
//    *
//    * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#shop-redact
//    */
//   SHOP_REDACT: {
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: '/api/webhooks',
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       // Payload has the following shape:
//       // {
//       //   "shop_id": 954889,
//       //   "shop_domain": "{shop}.myshopify.com"
//       // }
//     },
//   },

//   ORDERS_CREATE: {
    
//     deliveryMethod: DeliveryMethod.Http,
//     callbackUrl: "/api/webhooks", // WHERE SHOPIFY SENDS DATA FROM STOREFRONT
//     callback: async (topic, shop, body, webhookId) => {
//       const payload = JSON.parse(body);
//       let recentOrder = null;
//       recentOrder = payload; // Store the webhook data
//       console.log("Shopify webhook orders received:", payload);
//     },
//   },
// };

const PrivacyWebhookHandlers = {
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      recentWebhookPayload.CUSTOMERS_DATA_REQUEST = payload;
      console.log('Customers Data Request Webhook:', payload);
    },
  },

  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      recentWebhookPayload.CUSTOMERS_REDACT = payload;
      console.log('Customers Redact Webhook:', payload);
    },
  },

  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      recentWebhookPayload.SHOP_REDACT = payload;
      console.log('Shop Redact Webhook:', payload);
    },
  },

  ORDERS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks/ordercreate',
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      recentWebhookPayload.ORDERS_CREATE = payload;
      console.log('Orders Create Webhook:', payload);
    },
  },
};

export default PrivacyWebhookHandlers;
