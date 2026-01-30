export function generateStagingModel(
  name: string,
  source: string,
  warehouse: string
): string {
  const [schema, table] = source.includes(".") ? source.split(".").slice(-2) : ["raw", source];
  const modelName = name.startsWith("stg_") ? name : `stg_${name}`;
  
  const timestampCast = warehouse === "bigquery" 
    ? "cast(created_at as timestamp)" 
    : "created_at::timestamp";

  return `{{
  config(
    materialized='view',
    tags=['staging']
  )
}}

with source as (
    select * from {{ source('${schema}', '${table}') }}
),

renamed as (
    select
        -- IDs
        id as ${name}_id,
        
        -- Strings
        -- name,
        -- status,
        
        -- Numerics
        -- amount,
        
        -- Timestamps
        ${timestampCast} as created_at,
        ${timestampCast.replace("created_at", "updated_at")} as updated_at

    from source
)

select * from renamed
`;
}

export function generateIntermediateModel(
  name: string,
  source: string,
  warehouse: string
): string {
  const modelName = name.startsWith("int_") ? name : `int_${name}`;
  const sourceRef = source.startsWith("stg_") || source.startsWith("int_") 
    ? source 
    : `stg_${source}`;

  return `{{
  config(
    materialized='view',
    tags=['intermediate']
  )
}}

with ${sourceRef.replace(/^(stg_|int_)/, "")} as (
    select * from {{ ref('${sourceRef}') }}
),

-- Add business logic transformations here
transformed as (
    select
        *,
        -- Example: Add derived columns
        -- case 
        --     when status = 'active' then true 
        --     else false 
        -- end as is_active

    from ${sourceRef.replace(/^(stg_|int_)/, "")}
)

select * from transformed
`;
}

export function generateMartModel(
  name: string,
  source: string,
  type: "fact" | "dimension",
  warehouse: string
): string {
  const prefix = type === "fact" ? "fct" : "dim";
  const modelName = name.startsWith(`${prefix}_`) ? name : `${prefix}_${name}`;
  
  if (type === "dimension") {
    return `{{
  config(
    materialized='table',
    tags=['mart', 'dimension']
  )
}}

with source as (
    select * from {{ ref('${source}') }}
),

final as (
    select
        -- Surrogate key
        {{ dbt_utils.generate_surrogate_key(['${name}_id']) }} as ${name}_key,
        
        -- Natural key
        ${name}_id,
        
        -- Attributes
        -- name,
        -- description,
        -- type,
        
        -- Metadata
        created_at,
        updated_at,
        current_timestamp() as dbt_updated_at

    from source
)

select * from final
`;
  }

  // Fact table
  return `{{
  config(
    materialized='incremental',
    unique_key='${name}_id',
    tags=['mart', 'fact'],
    incremental_strategy='merge'
  )
}}

with source as (
    select * from {{ ref('${source}') }}
    {% if is_incremental() %}
    where updated_at > (select max(updated_at) from {{ this }})
      and updated_at < current_timestamp()
    {% endif %}
),

final as (
    select
        -- Keys
        ${name}_id,
        -- Add dimension foreign keys here
        -- customer_key,
        -- product_key,
        
        -- Measures
        -- quantity,
        -- amount,
        
        -- Degenerate dimensions
        -- order_number,
        
        -- Timestamps
        created_at,
        updated_at,
        current_timestamp() as dbt_updated_at

    from source
)

select * from final
`;
}

export function generateSnapshot(
  name: string,
  source: string,
  warehouse: string
): string {
  const [schema, table] = source.includes(".") ? source.split(".").slice(-2) : ["raw", source];

  return `{% snapshot ${name}_snapshot %}

{{
  config(
    target_schema='snapshots',
    unique_key='id',
    strategy='timestamp',
    updated_at='updated_at',
    invalidate_hard_deletes=True
  )
}}

select * from {{ source('${schema}', '${table}') }}

{% endsnapshot %}
`;
}

export function generateSourceYaml(name: string, source: string): string {
  const [schema, table] = source.includes(".") ? source.split(".").slice(-2) : [name, source || "table_name"];

  return `version: 2

sources:
  - name: ${schema}
    description: "Source data from ${schema}"
    database: "{{ env_var('DBT_DATABASE', 'your_database') }}"
    schema: ${schema}
    
    tables:
      - name: ${table}
        description: "Raw ${table} data"
        columns:
          - name: id
            description: "Primary key"
            data_tests:
              - unique
              - not_null
          - name: created_at
            description: "Timestamp when record was created"
          - name: updated_at
            description: "Timestamp when record was last updated"
        
        freshness:
          warn_after: { count: 12, period: hour }
          error_after: { count: 24, period: hour }
        loaded_at_field: updated_at
`;
}

export function generateTests(name: string, source: string): string {
  return `-- Custom data test for ${name}
-- Tests that ${name} data meets business requirements

with validation as (
    select
        ${name}_id,
        -- Add validation logic here
        case 
            when ${name}_id is null then 'missing_id'
            -- Add more validation rules
            else null
        end as validation_error
        
    from {{ ref('${source || name}') }}
)

select *
from validation
where validation_error is not null
`;
}

export function generateDocs(
  name: string,
  type: string,
  source?: string
): string {
  const description = getModelDescription(name, type, source);
  
  return `version: 2

models:
  - name: ${name}
    description: "${description}"
    
    columns:
      - name: ${name.replace(/^(stg_|int_|fct_|dim_)/, "")}_id
        description: "Primary key"
        data_tests:
          - unique
          - not_null
      
      - name: created_at
        description: "Timestamp when record was created"
        
      - name: updated_at
        description: "Timestamp when record was last updated"
`;
}

function getModelDescription(name: string, type: string, source?: string): string {
  const baseName = name.replace(/^(stg_|int_|fct_|dim_|obt_)/, "").replace(/_/g, " ");
  
  switch (type) {
    case "staging":
      return `Staging model for ${baseName}. Provides cleaned and typed source data from ${source || "raw source"}.`;
    case "intermediate":
      return `Intermediate model for ${baseName}. Applies business logic and transformations.`;
    case "fact":
      return `Fact table for ${baseName}. Contains measurable, quantitative data for analysis.`;
    case "dimension":
      return `Dimension table for ${baseName}. Contains descriptive attributes for slicing and dicing facts.`;
    case "mart":
      return `Mart model for ${baseName}. Business-ready data model for analytics and reporting.`;
    default:
      return `Model for ${baseName} data.`;
  }
}
