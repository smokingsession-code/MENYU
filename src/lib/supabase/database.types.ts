
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"agent_commissions": {
                  Row: {
                    "agent_id": string,"amount_ugx": number,"created_at": string,"deleted_at": string | null,"earned_at": string,"id": string,"payment_id": string | null,"restaurant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"amount_ugx": number,"created_at"?: string,"deleted_at"?: string | null,"earned_at"?: string,"id"?: string,"payment_id"?: string | null,"restaurant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "agent_id"?: string,"amount_ugx"?: number,"created_at"?: string,"deleted_at"?: string | null,"earned_at"?: string,"id"?: string,"payment_id"?: string | null,"restaurant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_commissions_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_commissions_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_commissions_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_payouts": {
                  Row: {
                    "agent_id": string,"amount_ugx": number,"created_at": string,"deleted_at": string | null,"id": string,"method": string | null,"notes": string | null,"paid_at": string,"recorded_by": string | null,"transaction_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"amount_ugx": number,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"method"?: string | null,"notes"?: string | null,"paid_at"?: string,"recorded_by"?: string | null,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "agent_id"?: string,"amount_ugx"?: number,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"method"?: string | null,"notes"?: string | null,"paid_at"?: string,"recorded_by"?: string | null,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_payouts_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"agents": {
                  Row: {
                    "code": string,"commission_ugx": number | null,"created_at": string,"deleted_at": string | null,"id": string,"is_active": boolean,"name": string,"notes": string | null,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"commission_ugx"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"commission_ugx"?: number | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"id": number,"restaurant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"restaurant_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"restaurant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"branches": {
                  Row: {
                    "accepts_delivery": boolean,"accepts_dine_in": boolean,"accepts_takeaway": boolean,"address": string | null,"area": string | null,"created_at": string,"deleted_at": string | null,"delivery_note": string | null,"id": string,"is_main": boolean,"lat": number | null,"lng": number | null,"menu_id": string,"momo_airtel_code": string | null,"momo_airtel_name": string | null,"momo_mtn_code": string | null,"momo_mtn_name": string | null,"name": string | null,"opening_hours": NonNullable<Json>,"phone": string | null,"restaurant_id": string,"slug": string,"sort_order": number,"updated_at": string,"whatsapp": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepts_delivery"?: boolean,"accepts_dine_in"?: boolean,"accepts_takeaway"?: boolean,"address"?: string | null,"area"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"delivery_note"?: string | null,"id"?: string,"is_main"?: boolean,"lat"?: number | null,"lng"?: number | null,"menu_id": string,"momo_airtel_code"?: string | null,"momo_airtel_name"?: string | null,"momo_mtn_code"?: string | null,"momo_mtn_name"?: string | null,"name"?: string | null,"opening_hours"?: NonNullable<Json>,"phone"?: string | null,"restaurant_id": string,"slug": string,"sort_order"?: number,"updated_at"?: string,"whatsapp"?: string | null
                  }
                  Update: {
                    "accepts_delivery"?: boolean,"accepts_dine_in"?: boolean,"accepts_takeaway"?: boolean,"address"?: string | null,"area"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"delivery_note"?: string | null,"id"?: string,"is_main"?: boolean,"lat"?: number | null,"lng"?: number | null,"menu_id"?: string,"momo_airtel_code"?: string | null,"momo_airtel_name"?: string | null,"momo_mtn_code"?: string | null,"momo_mtn_name"?: string | null,"name"?: string | null,"opening_hours"?: NonNullable<Json>,"phone"?: string | null,"restaurant_id"?: string,"slug"?: string,"sort_order"?: number,"updated_at"?: string,"whatsapp"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "branches_menu_id_restaurant_id_fkey"
      columns: ["menu_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "menus"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "branches_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"is_hidden": boolean,"menu_id": string,"name": string,"name_lg": string | null,"restaurant_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_hidden"?: boolean,"menu_id": string,"name": string,"name_lg"?: string | null,"restaurant_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_hidden"?: boolean,"menu_id"?: string,"name"?: string,"name_lg"?: string | null,"restaurant_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_menu_id_restaurant_id_fkey"
      columns: ["menu_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "menus"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "categories_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "branch_id": string,"id": number,"item_id": string | null,"occurred_at": string,"restaurant_id": string,"session_id": string | null,"table_code": string | null,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"id"?: never,"item_id"?: string | null,"occurred_at"?: string,"restaurant_id": string,"session_id"?: string | null,"table_code"?: string | null,"type": string
                  }
                  Update: {
                    "branch_id"?: string,"id"?: never,"item_id"?: string | null,"occurred_at"?: string,"restaurant_id"?: string,"session_id"?: string | null,"table_code"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "events_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"feedback": {
                  Row: {
                    "branch_id": string,"comment": string | null,"created_at": string,"deleted_at": string | null,"id": string,"rating": number,"read_at": string | null,"restaurant_id": string,"table_code": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"comment"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"rating": number,"read_at"?: string | null,"restaurant_id": string,"table_code"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string,"comment"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"rating"?: number,"read_at"?: string | null,"restaurant_id"?: string,"table_code"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feedback_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "feedback_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"branch_id": string | null,"created_at": string,"deleted_at": string | null,"email": string | null,"expires_at": string,"id": string,"invited_by": string | null,"phone": string | null,"restaurant_id": string,"role": string,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"branch_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"phone"?: string | null,"restaurant_id": string,"role": string,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"branch_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"phone"?: string | null,"restaurant_id"?: string,"role"?: string,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "invitations_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"item_options": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"item_id": string,"kind": string,"name": string,"name_lg": string | null,"price_ugx": number,"restaurant_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"item_id": string,"kind": string,"name": string,"name_lg"?: string | null,"price_ugx": number,"restaurant_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"item_id"?: string,"kind"?: string,"name"?: string,"name_lg"?: string | null,"price_ugx"?: number,"restaurant_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_options_item_id_restaurant_id_fkey"
      columns: ["item_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "item_options_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "category_id": string,"created_at": string,"deleted_at": string | null,"description": string | null,"description_lg": string | null,"id": string,"is_hidden": boolean,"menu_id": string,"name": string,"name_lg": string | null,"photo": Json | null,"price_ugx": number | null,"restaurant_id": string,"sort_order": number,"tags": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"description_lg"?: string | null,"id"?: string,"is_hidden"?: boolean,"menu_id": string,"name": string,"name_lg"?: string | null,"photo"?: Json | null,"price_ugx"?: number | null,"restaurant_id": string,"sort_order"?: number,"tags"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"description_lg"?: string | null,"id"?: string,"is_hidden"?: boolean,"menu_id"?: string,"name"?: string,"name_lg"?: string | null,"photo"?: Json | null,"price_ugx"?: number | null,"restaurant_id"?: string,"sort_order"?: number,"tags"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_category_id_menu_id_fkey"
      columns: ["category_id","menu_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","menu_id"]
    },{
      foreignKeyName: "items_menu_id_restaurant_id_fkey"
      columns: ["menu_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "menus"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "items_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "branch_id": string | null,"created_at": string,"deleted_at": string | null,"id": string,"restaurant_id": string,"role": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"restaurant_id": string,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "branch_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"restaurant_id"?: string,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "memberships_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"menu_imports": {
                  Row: {
                    "ai_result": Json | null,"attempts": number,"created_at": string,"created_by": string | null,"deleted_at": string | null,"draft": Json | null,"error_code": string | null,"error_message": string | null,"files": NonNullable<Json>,"id": string,"menu_id": string,"model": string | null,"published_at": string | null,"published_by": string | null,"restaurant_id": string,"status": string,"updated_at": string,"usage": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_result"?: Json | null,"attempts"?: number,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"draft"?: Json | null,"error_code"?: string | null,"error_message"?: string | null,"files"?: NonNullable<Json>,"id"?: string,"menu_id": string,"model"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"restaurant_id": string,"status"?: string,"updated_at"?: string,"usage"?: Json | null
                  }
                  Update: {
                    "ai_result"?: Json | null,"attempts"?: number,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"draft"?: Json | null,"error_code"?: string | null,"error_message"?: string | null,"files"?: NonNullable<Json>,"id"?: string,"menu_id"?: string,"model"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"restaurant_id"?: string,"status"?: string,"updated_at"?: string,"usage"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_imports_menu_id_restaurant_id_fkey"
      columns: ["menu_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "menus"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "menu_imports_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"menus": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"name": string,"restaurant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"restaurant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"restaurant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menus_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_ugx": number,"billing_interval": string | null,"created_at": string,"deleted_at": string | null,"id": string,"kind": string,"method": string,"notes": string | null,"paid_at": string,"period_end": string | null,"period_start": string | null,"plan": string | null,"provider": string,"provider_ref": string | null,"raw": Json | null,"recorded_by": string | null,"restaurant_id": string,"status": string,"transaction_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_ugx": number,"billing_interval"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: string,"method": string,"notes"?: string | null,"paid_at"?: string,"period_end"?: string | null,"period_start"?: string | null,"plan"?: string | null,"provider"?: string,"provider_ref"?: string | null,"raw"?: Json | null,"recorded_by"?: string | null,"restaurant_id": string,"status"?: string,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_ugx"?: number,"billing_interval"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: string,"method"?: string,"notes"?: string | null,"paid_at"?: string,"period_end"?: string | null,"period_start"?: string | null,"plan"?: string | null,"provider"?: string,"provider_ref"?: string | null,"raw"?: Json | null,"recorded_by"?: string | null,"restaurant_id"?: string,"status"?: string,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_plan_fkey"
      columns: ["plan"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "payments_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "code": string,"features": NonNullable<Json>,"limits": NonNullable<Json>,"name": string,"price_monthly_ugx": number,"price_per_branch": boolean,"price_yearly_ugx": number | null,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"features"?: NonNullable<Json>,"limits"?: NonNullable<Json>,"name": string,"price_monthly_ugx": number,"price_per_branch"?: boolean,"price_yearly_ugx"?: number | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"features"?: NonNullable<Json>,"limits"?: NonNullable<Json>,"name"?: string,"price_monthly_ugx"?: number,"price_per_branch"?: boolean,"price_yearly_ugx"?: number | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string | null,"full_name": string | null,"id": string,"locale": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id": string,"locale"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id"?: string,"locale"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"referrals": {
                  Row: {
                    "created_at": string,"id": string,"qualifying_payment_id": string | null,"referred_id": string,"referrer_id": string,"reward_months": number,"rewarded_at": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"qualifying_payment_id"?: string | null,"referred_id": string,"referrer_id": string,"reward_months"?: number,"rewarded_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"qualifying_payment_id"?: string | null,"referred_id"?: string,"referrer_id"?: string,"reward_months"?: number,"rewarded_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "referrals_qualifying_payment_id_fkey"
      columns: ["qualifying_payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "referrals_referred_id_fkey"
      columns: ["referred_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "referrals_referrer_id_fkey"
      columns: ["referrer_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurants": {
                  Row: {
                    "agent_id": string | null,"brand_color": string,"content_version": number,"cover": Json | null,"created_at": string,"created_by": string | null,"cuisines": (string)[],"deleted_at": string | null,"description": string | null,"description_lg": string | null,"directory_status": string,"id": string,"is_demo": boolean,"is_featured": boolean,"is_suspended": boolean,"logo": Json | null,"menu_updated_at": string | null,"name": string,"price_range": number | null,"referral_code": string,"referred_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id"?: string | null,"brand_color"?: string,"content_version"?: number,"cover"?: Json | null,"created_at"?: string,"created_by"?: string | null,"cuisines"?: (string)[],"deleted_at"?: string | null,"description"?: string | null,"description_lg"?: string | null,"directory_status"?: string,"id"?: string,"is_demo"?: boolean,"is_featured"?: boolean,"is_suspended"?: boolean,"logo"?: Json | null,"menu_updated_at"?: string | null,"name": string,"price_range"?: number | null,"referral_code"?: string,"referred_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "agent_id"?: string | null,"brand_color"?: string,"content_version"?: number,"cover"?: Json | null,"created_at"?: string,"created_by"?: string | null,"cuisines"?: (string)[],"deleted_at"?: string | null,"description"?: string | null,"description_lg"?: string | null,"directory_status"?: string,"id"?: string,"is_demo"?: boolean,"is_featured"?: boolean,"is_suspended"?: boolean,"logo"?: Json | null,"menu_updated_at"?: string | null,"name"?: string,"price_range"?: number | null,"referral_code"?: string,"referred_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurants_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "restaurants_referred_by_fkey"
      columns: ["referred_by"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"setup_requests": {
                  Row: {
                    "assigned_to": string | null,"completed_at": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"deleted_at": string | null,"files": NonNullable<Json>,"id": string,"kind": string,"notes": string | null,"requested_by": string | null,"restaurant_id": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"files"?: NonNullable<Json>,"id"?: string,"kind"?: string,"notes"?: string | null,"requested_by"?: string | null,"restaurant_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_to"?: string | null,"completed_at"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"files"?: NonNullable<Json>,"id"?: string,"kind"?: string,"notes"?: string | null,"requested_by"?: string | null,"restaurant_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "setup_requests_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"sold_out": {
                  Row: {
                    "branch_id": string,"created_at": string,"created_by": string | null,"item_id": string,"restaurant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"created_at"?: string,"created_by"?: string | null,"item_id": string,"restaurant_id": string
                  }
                  Update: {
                    "branch_id"?: string,"created_at"?: string,"created_by"?: string | null,"item_id"?: string,"restaurant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sold_out_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "sold_out_item_id_restaurant_id_fkey"
      columns: ["item_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "sold_out_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"special_items": {
                  Row: {
                    "item_id": string,"quantity": number,"restaurant_id": string,"special_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "item_id": string,"quantity"?: number,"restaurant_id": string,"special_id": string
                  }
                  Update: {
                    "item_id"?: string,"quantity"?: number,"restaurant_id"?: string,"special_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "special_items_item_id_restaurant_id_fkey"
      columns: ["item_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "special_items_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "special_items_special_id_restaurant_id_fkey"
      columns: ["special_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "specials"
      referencedColumns: ["id","restaurant_id"]
    }
                  ]
                },"specials": {
                  Row: {
                    "branch_id": string | null,"created_at": string,"days": (number)[],"deleted_at": string | null,"description": string | null,"description_lg": string | null,"end_time": string,"ends_on": string | null,"id": string,"is_active": boolean,"price_ugx": number | null,"restaurant_id": string,"sort_order": number,"start_time": string,"starts_on": string | null,"title": string,"title_lg": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"created_at"?: string,"days"?: (number)[],"deleted_at"?: string | null,"description"?: string | null,"description_lg"?: string | null,"end_time"?: string,"ends_on"?: string | null,"id"?: string,"is_active"?: boolean,"price_ugx"?: number | null,"restaurant_id": string,"sort_order"?: number,"start_time"?: string,"starts_on"?: string | null,"title": string,"title_lg"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string | null,"created_at"?: string,"days"?: (number)[],"deleted_at"?: string | null,"description"?: string | null,"description_lg"?: string | null,"end_time"?: string,"ends_on"?: string | null,"id"?: string,"is_active"?: boolean,"price_ugx"?: number | null,"restaurant_id"?: string,"sort_order"?: number,"start_time"?: string,"starts_on"?: string | null,"title"?: string,"title_lg"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "specials_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "specials_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "billing_interval": string,"created_at": string,"grace_days": number,"last_reminder_at": string | null,"notes": string | null,"paid_until": string | null,"plan": string,"restaurant_id": string,"setup_fee_ugx": number | null,"status": string,"status_changed_at": string,"trial_ends_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_interval"?: string,"created_at"?: string,"grace_days"?: number,"last_reminder_at"?: string | null,"notes"?: string | null,"paid_until"?: string | null,"plan"?: string,"restaurant_id": string,"setup_fee_ugx"?: number | null,"status"?: string,"status_changed_at"?: string,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "billing_interval"?: string,"created_at"?: string,"grace_days"?: number,"last_reminder_at"?: string | null,"notes"?: string | null,"paid_until"?: string | null,"plan"?: string,"restaurant_id"?: string,"setup_fee_ugx"?: number | null,"status"?: string,"status_changed_at"?: string,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_plan_fkey"
      columns: ["plan"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "subscriptions_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"tables": {
                  Row: {
                    "branch_id": string,"code": string,"created_at": string,"deleted_at": string | null,"id": string,"label": string,"restaurant_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"code": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"label": string,"restaurant_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string,"code"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"label"?: string,"restaurant_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tables_branch_id_restaurant_id_fkey"
      columns: ["branch_id","restaurant_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","restaurant_id"]
    },{
      foreignKeyName: "tables_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_tables":
{ Args: { "p_branch_id": string,"p_labels": (string)[] }; Returns: number
                           },
"apply_billing_status":
{ Args: { "p_from": string,"p_restaurant_id": string,"p_to": string }; Returns: boolean
                           },
"bulk_adjust_prices":
{ Args: { "p_category_ids": (string)[],"p_percent": number,"p_restaurant_id": string,"p_round"?: number }; Returns: number
                           },
"claim_invitations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"create_invitation":
{ Args: { "p_branch_id"?: string,"p_email"?: string,"p_phone"?: string,"p_restaurant_id": string,"p_role": string }; Returns: Json
                           },
"create_restaurant":
{ Args: { "p_agent_code"?: string,"p_area"?: string,"p_name": string,"p_owner_email"?: string,"p_owner_phone"?: string,"p_referral_code"?: string,"p_trial_days"?: number,"p_whatsapp"?: string }; Returns: Json
                           },
"get_public_menu":
{ Args: { "p_slug": string }; Returns: Json
                           },
"invitation_preview":
{ Args: { "p_token": string }; Returns: Json
                           },
"prune_rate_limits":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"publish_menu_import":
{ Args: { "p_draft": Json,"p_import_id": string,"p_mode"?: string }; Returns: Json
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"record_event":
{ Args: { "p_item"?: string,"p_rate_key"?: string,"p_session"?: string,"p_slug": string,"p_table"?: string,"p_type": string }; Returns: Json
                           },
"record_payment":
{ Args: { "p": Json }; Returns: Json
                           },
"remove_payment":
{ Args: { "p": Json }; Returns: undefined
                           },
"reorder":
{ Args: { "p_ids": (string)[],"p_kind": string }; Returns: number
                           },
"restaurant_insights":
{ Args: { "p_days"?: number,"p_restaurant_id": string }; Returns: Json
                           },
"save_item":
{ Args: { "p_item": Json }; Returns: string
                           },
"save_special":
{ Args: { "p": Json }; Returns: string
                           },
"set_subscription":
{ Args: { "p": Json }; Returns: undefined
                           },
"submit_feedback":
{ Args: { "p_comment"?: string,"p_rate_key"?: string,"p_rating": number,"p_slug": string,"p_table"?: string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
