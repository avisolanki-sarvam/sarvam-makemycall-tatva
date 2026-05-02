declare module 'react-native-razorpay' {
  export interface RazorpayCheckoutOptions {
    key: string;
    order_id?: string;
    amount?: number;
    currency?: string;
    name?: string;
    description?: string;
    prefill?: {
      contact?: string;
      email?: string;
      name?: string;
    };
    theme?: {
      color?: string;
    };
    [key: string]: unknown;
  }

  export interface RazorpayCheckoutResult {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
    [key: string]: unknown;
  }

  export interface RazorpayCheckout {
    open(options: RazorpayCheckoutOptions): Promise<RazorpayCheckoutResult>;
  }

  const RazorpayCheckout: RazorpayCheckout;
  export default RazorpayCheckout;
}
