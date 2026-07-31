import { describe, expect, it } from "vitest"
import { calculateGrossMarginAdjustedRatio } from "@/lib/adjustment"

describe("calculateGrossMarginAdjustedRatio", () => {
	it("calculates price from the configured gross margin", () => {
		expect(calculateGrossMarginAdjustedRatio(0.04, 20)).toBe(0.05)
	})

	it("rejects invalid ratio inputs", () => {
		expect(calculateGrossMarginAdjustedRatio(0, 20)).toBeNull()
		expect(calculateGrossMarginAdjustedRatio(0.04, -1)).toBeNull()
		expect(calculateGrossMarginAdjustedRatio(0.04, 100)).toBeNull()
	})
})
