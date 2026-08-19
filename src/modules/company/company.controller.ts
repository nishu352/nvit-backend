import { FastifyRequest, FastifyReply } from "fastify";
import { companySearchSchema } from "./company.schema.js";
import { searchCompanies, getCompanyAutocomplete } from "./company.service.js";

export async function searchCompaniesHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = companySearchSchema.safeParse(request.query);
  if (!result.success) {
    return reply.status(400).send({ error: true, errors: result.error.format() });
  }

  try {
    const limit = parseInt(result.data.limit, 10) || 20;
    const page = parseInt(result.data.page, 10) || 1;
    const data = await searchCompanies(result.data.q, {
      limit,
      page,
      pincode: result.data.pincode,
      city: result.data.city,
      state: result.data.state,
      bankId: result.data.bankId,
      category: result.data.category,
    });

    return reply.send({
      success: true,
      count: data.length,
      page,
      data,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Failed to search companies" });
  }
}

export async function autocompleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { q } = request.query as { q?: string };
  if (!q || q.trim().length === 0) {
    return reply.send({ success: true, data: [] });
  }

  try {
    const suggestions = await getCompanyAutocomplete(q);
    return reply.send({
      success: true,
      data: suggestions,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: true, message: err.message || "Autocomplete error" });
  }
}
